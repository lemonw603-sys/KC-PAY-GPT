/**
 * The customer-facing name of each plan. Shared by every surface a customer
 * reads — order status, code verification — so one product never appears under
 * two names. The database's own `products.display_name` wins when present;
 * this is the fallback for rows that have no product joined yet (an unredeemed
 * code knows its plan but has no order, and therefore no product row).
 */
export const PRODUCT_LABELS = Object.freeze({
  plus: 'ChatGPT Plus',
  pro_5x: 'ChatGPT Pro 5X',
  pro_20x: 'ChatGPT Pro 20X'
});

export function productLabel(planType) {
  return PRODUCT_LABELS[String(planType || '').toLowerCase()] || 'ChatGPT Plus';
}

/** 运营侧（推送、后台）的短名：Plus / 5X / 20X（D-244 的叫法）。 */
export const PRODUCT_SHORT_LABELS = Object.freeze({ plus: 'Plus', pro_5x: '5X', pro_20x: '20X' });

export function productShortLabel(planType) {
  return PRODUCT_SHORT_LABELS[String(planType || '').toLowerCase()] || String(planType || '');
}
