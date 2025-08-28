-- 4) Atomic RPC for scanning
CREATE OR REPLACE FUNCTION public.scan_item(
  p_dispatch_id bigint,
  p_barcode text
)
RETURNS json
LANGUAGE plpgsql
AS $$
DECLARE
  v_item record;
  v_now timestamptz := now();
BEGIN
  SELECT i.*
    INTO v_item
  FROM public.inventory i
  WHERE i.barcode = p_barcode
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN json_build_object('ok', false, 'code', 'NOT_FOUND', 'msg', 'Barcode not found');
  END IF;

  IF COALESCE(v_item.status, 'Available') <> 'Available' THEN
    RETURN json_build_object('ok', false, 'code', 'NOT_AVAILABLE', 'msg', 'Item is not Available');
  END IF;

  -- FIFO check
  IF NOT public.fifo_is_ok(v_item.id) THEN
    RETURN json_build_object('ok', false, 'code', 'NOT_FIFO', 'msg', 'FIFO violation: older stock exists');
  END IF;

  -- Reserve + link to dispatch
  UPDATE public.inventory i
    SET status = 'Reserved',
        dispatch_id = p_dispatch_id,
        reserved_at = v_now
  WHERE i.id = v_item.id;

  -- Insert into dispatch_items if not already there
  INSERT INTO public.dispatch_items(dispatch_id, inventory_id, created_at)
  VALUES (p_dispatch_id, v_item.id, v_now)
  ON CONFLICT DO NOTHING;

  -- Return minimal details for UI
  RETURN json_build_object(
    'ok', true,
    'inventory_id', v_item.id,
    'sku_id', v_item.sku_id,
    'barcode', v_item.barcode,
    'status', 'Reserved'
  );
END;
$$;

-- 5) Finalize a dispatch = mark all its items Sold and set date_out
CREATE OR REPLACE FUNCTION public.finalize_dispatch(
  p_dispatch_id bigint,
  p_dispatch_date date
)
RETURNS json
LANGUAGE plpgsql
AS $$
DECLARE
  v_count int;
BEGIN
  UPDATE public.inventory i
    SET status = 'Sold',
        date_out = p_dispatch_date
  WHERE i.dispatch_id = p_dispatch_id;

  GET DIAGNOSTICS v_count = ROW_COUNT;

  RETURN json_build_object('ok', true, 'updated', v_count);
END;
$$;
