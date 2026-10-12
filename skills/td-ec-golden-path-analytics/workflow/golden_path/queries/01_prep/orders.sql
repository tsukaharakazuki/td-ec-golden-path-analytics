-- gp_orders: POS 明細 → 注文単位
SELECT
  order_id
  , MAX(member_id) AS member_id
  , MIN(order_time) AS order_time
  , MAX(channel) AS channel
  , SUM(amount) AS amount
  , SUM(quantity) AS quantity
  , COUNT(*) AS lines
FROM gp_order_lines
GROUP BY order_id
