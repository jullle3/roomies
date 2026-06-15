let apiUrl;
let directApiUrl;
let s3Url;
let basePath;
let google_auth_client_id = '366403938694-rcp7his4velfc5n85745vt5utdi9tdd0.apps.googleusercontent.com'
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
    google_auth_redirect_url = "https://hidden-slice-416812.ew.r.appspot.com/roomies/login/google/callback"
} else if (window.location.hostname === 'dev.roomies-15m.pages.dev') {
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
    google_auth_redirect_url = "https://hidden-slice-416812.ew.r.appspot.com/roomies/login/google/callback"
} else if (window.location.hostname === 'roomiedanmark.dk') {
    environment = 'prod';
    // App Engine proxied.
    apiUrl = 'https://api2.andelsboligbasen.dk';
    // Direct connection to our backend. Not all requests need to be routed through cloudflare since it takes 50-100ms more
    directApiUrl = 'https://prod-dot-hidden-slice-416812.ew.r.appspot.com';
    s3Url = 'https://images.andelsboligbasen.dk';
    basePath = '';
    google_auth_redirect_url = "https://prod-dot-hidden-slice-416812.ew.r.appspot.com/roomies/login/google/callback"
} else {
    environment = 'unknown';
    console.log("Can't load configurations")
}

export {basePath, apiUrl, directApiUrl, s3Url, google_auth_client_id, google_auth_redirect_url, environment};
