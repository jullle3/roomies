let apiUrl;
let directApiUrl;
let s3Url;
let basePath;
let stripe_customer_portal;
let stripe_buy_button_id;
let stripe_buy_button_publishable_key;
let google_auth_client_id = '915577844948-sllkpu74v67o46dsg5rer7tgmlck5mh8.apps.googleusercontent.com'
let google_auth_redirect_url;
let environment;



if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
    environment = 'local';
    apiUrl = 'http://localhost:8080';
    // apiUrl = 'https://api2-dev.andelsboligbasen.dk';
    // directApiUrl = 'https://hidden-slice-416812.ew.r.appspot.com';
    directApiUrl = 'http://localhost:8080';
    s3Url = 'https://dev-images.andelsboligbasen.dk';
    basePath = '/roomies';  // Required since intellij hosts on a different path
    stripe_customer_portal = 'https://billing.stripe.com/p/login/test_14kaFp1Rc6wX0Le9AA'
    stripe_buy_button_id = "buy_btn_1RFXuQRwMNhLL1Z9c9QTJ8Hk";
    stripe_buy_button_publishable_key = "pk_test_51PhrGIRwMNhLL1Z9dUFZqpxKIZrfZr64BTyUmHwWdEUjWjm3XulkLuozpbOuFT7dmkzKYAQ1ePD2cV2HLEnD1yMC00Q95j5SB1";
    google_auth_redirect_url = "https://api2-dev.andelsboligbasen.dk/login/google/callback"
} else if (window.location.hostname === 'dev.roomies.dk') {
    environment = 'dev';
    // Dev routed through cloudflare
    // Cloud Run
    // apiUrl = 'https://api-dev.roomies.dk';
    // App Engine proxied. Underligt nok så gør min cloudflare cache rule at requests tager 100 ms længere tid til min backend, fremfor at sende det direkte. Men det går nok...
    apiUrl = 'https://api2-dev.andelsboligbasen.dk';
    // Direct connection to our backend. Not all requests need to be routed through cloudflare since it takes 50-100ms more
    directApiUrl = 'https://hidden-slice-416812.ew.r.appspot.com';
    s3Url = 'https://dev-images.andelsboligbasen.dk';
    //s3Url = 'https://images.andelsboligbasen.dk'; // TODO: Always tmp, if not commented out!
    basePath = '';
    stripe_customer_portal = 'https://billing.stripe.com/p/login/test_14kaFp1Rc6wX0Le9AA'
    stripe_buy_button_id = "buy_btn_1RFXuQRwMNhLL1Z9c9QTJ8Hk";
    stripe_buy_button_publishable_key = "pk_test_51PhrGIRwMNhLL1Z9dUFZqpxKIZrfZr64BTyUmHwWdEUjWjm3XulkLuozpbOuFT7dmkzKYAQ1ePD2cV2HLEnD1yMC00Q95j5SB1";
    google_auth_redirect_url = "https://api2-dev.andelsboligbasen.dk/login/google/callback"
} else if (window.location.hostname === 'roomiedanmark.dk') {
    environment = 'prod';
    // App Engine proxied.
    apiUrl = 'https://api2.andelsboligbasen.dk';
    // Direct connection to our backend. Not all requests need to be routed through cloudflare since it takes 50-100ms more
    directApiUrl = 'https://prod-dot-hidden-slice-416812.ew.r.appspot.com';
    s3Url = 'https://images.andelsboligbasen.dk';
    basePath = '';
    stripe_customer_portal = 'https://billing.stripe.com/p/login/14A5kFgJs1SPccK0BK77O00'
    stripe_buy_button_id = "buy_btn_1RQEFTRwMNhLL1Z9eCaDpc4m";
    stripe_buy_button_publishable_key = "pk_live_51PhrGIRwMNhLL1Z99yqXJLqrjii7tyL4WnqrCdnONlUbq0t7RSkL0KP32iXrSMaUCfPUjVE04nJpiMtPxcwQVsVD00IcplfvP9";
    google_auth_redirect_url = "https://api2.andelsboligbasen.dk/login/google/callback"
} else {
    environment = 'unknown';
    console.log("Can't load configurations")
}

export {basePath, apiUrl, directApiUrl, s3Url, stripe_customer_portal, stripe_buy_button_id, stripe_buy_button_publishable_key, google_auth_client_id, google_auth_redirect_url, environment};
