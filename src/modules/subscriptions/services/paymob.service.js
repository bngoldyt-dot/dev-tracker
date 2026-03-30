const axios = require('axios');
const ApiError = require('../../../utils/apiErrors');

const PAYMOB_BASE_URL = 'https://accept.paymob.com/api';

const getAuthToken = async () => {
  try {
    const response = await axios.post(`${PAYMOB_BASE_URL}/auth/tokens`, {
      api_key: process.env.PAYMOB_API_KEY
    });
    return response.data.token;
  } catch (error) {
    throw new ApiError(500, `Paymob Auth Error: ${error.response?.data?.message || error.message}`);
  }
};

const registerOrder = async ({ token, amountCents, currency = "EGP", merchantOrderId }) => {
  try {
    const response = await axios.post(`${PAYMOB_BASE_URL}/ecommerce/orders`, {
      auth_token: token,
      delivery_needed: "false",
      amount_cents: amountCents.toString(),
      currency: currency,
      merchant_order_id: merchantOrderId
    });
    return response.data.id;
  } catch (error) {
    throw new ApiError(500, `Paymob Order Error: ${error.response?.data?.message || error.message}`);
  }
};

const getPaymentKey = async ({ token, orderId, amountCents, developer, integrationId }) => {
  try {
    const firstName = developer.name ? developer.name.split(' ')[0] : "NA";
    const lastName = developer.name && developer.name.split(' ').length > 1 
      ? developer.name.split(' ').slice(1).join(' ') 
      : "Developer";

    const billingData = {
      apartment: "NA", 
      email: developer.email || "NA", 
      floor: "NA", 
      first_name: firstName, 
      street: "NA", 
      building: "NA", 
      phone_number: "NA", // Assuming developer model doesn't have phone, fallback to NA
      shipping_method: "NA", 
      postal_code: "NA", 
      city: "NA", 
      country: "EG", 
      last_name: lastName, 
      state: "NA"
    };

    const response = await axios.post(`${PAYMOB_BASE_URL}/acceptance/payment_keys`, {
      auth_token: token,
      amount_cents: amountCents.toString(),
      expiration: 3600, 
      order_id: orderId,
      billing_data: billingData,
      currency: "EGP",
      integration_id: integrationId || process.env.PAYMOB_INTEGRATION_ID
    });
    return response.data.token;
  } catch (error) {
    throw new ApiError(500, `Paymob Payment Key Error: ${error.response?.data?.message || error.message}`);
  }
};

const buildIframeUrl = (paymentKey) => {
  return `https://accept.paymob.com/api/acceptance/iframes/${process.env.PAYMOB_IFRAME_ID}?payment_token=${paymentKey}`;
};

module.exports = {
  getAuthToken,
  registerOrder,
  getPaymentKey,
  buildIframeUrl
};
