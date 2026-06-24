import {basePath, stripe_customer_portal} from "../config/config.js";

export function SetupFooter() {
    const currentYear = new Date().getFullYear();

    document.body.insertAdjacentHTML('beforeend', `
<style>
  /* Specifikke style guide transitions for footeren */
  .footer-pseo-link {
    transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
    display: inline-block; /* Nødvendig for at transform virker */
  }
  .footer-pseo-link:hover {
    color: var(--bs-primary) !important;
    transform: translateX(4px); /* Giver en taktil, fysisk følelse */
  }
  .footer-social-link {
    transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
  }
  .footer-social-link-facebook {
    color: #1877f2 !important;
  }
  .footer-social-link-instagram {
    color: #e4405f !important;
  }
  .footer-social-link:hover {
    transform: translateY(-2px);
  }
  .footer-social-link-facebook:hover {
    color: #0f5dc7 !important;
  }
  .footer-social-link-instagram:hover {
    color: #c13584 !important;
  }
</style>

<section class="border-top pt-5 pb-4 bg-light" style="font-family: 'Lato', sans-serif;" aria-label="Find værelse i Danmark">
  <div class="container" style="max-width: 1500px;">
    <div class="row g-4">
      <div class="col-6 col-md-3">
        <h6 class="fw-bold mb-3 text-dark">Værelser</h6>
        <ul class="list-unstyled d-flex flex-column gap-2 mb-0">
          <li><a href="/vaerelser/" class="text-decoration-none text-muted footer-pseo-link fw-semibold">Værelser i hele Danmark</a></li>
          <li><a href="/vaerelser/koebenhavn/" class="text-decoration-none text-muted footer-pseo-link fw-semibold">Værelser i København</a></li>
          <li><a href="/vaerelser/aarhus/" class="text-decoration-none text-muted footer-pseo-link fw-semibold">Værelser i Aarhus</a></li>
          <li><a href="/vaerelser/odense/" class="text-decoration-none text-muted footer-pseo-link fw-semibold">Værelser i Odense</a></li>
          <li><a href="/vaerelser/aalborg/" class="text-decoration-none text-muted footer-pseo-link fw-semibold">Værelser i Aalborg</a></li>
        </ul>
      </div>
      <div class="col-6 col-md-3">
        <h6 class="fw-bold mb-3 text-dark">Studiebolig</h6>
        <ul class="list-unstyled d-flex flex-column gap-2 mb-0">
          <li><a href="/studiebolig/" class="text-decoration-none text-muted footer-pseo-link fw-semibold">Studiebolig i Danmark</a></li>
        </ul>
      </div>
    </div>
  </div>
</section>

<footer class="border-top pt-5 pb-4 bg-light" style="font-family: 'Lato', sans-serif;">
  <div class="container" style="max-width: 1500px;">
    
    <div class="row align-items-center">
        <div class="col-12 col-md-4 text-center text-md-start order-2 order-md-1">
          <div class="mb-3 d-flex justify-content-center justify-content-md-start gap-3">
            <a href="https://www.facebook.com/profile.php?id=61590630037356" target="_blank" aria-label="Følg os på Facebook" class="text-decoration-none footer-social-link footer-social-link-facebook">
              <i class="fa-brands fa-facebook fs-4" style="line-height: 1"></i>
            </a>
          </div>
          <small class="text-muted fw-medium">
            &copy; ${currentYear} RoomieDanmark
          </small>
        </div>

      <div class="col-12 col-md-4 text-center order-1 order-md-2 mb-4 mb-md-0">
        <a href="/" class="d-inline-block hover-lift" style="transition: transform 0.2s cubic-bezier(0.4, 0, 0.2, 1);">
          <img src="${basePath}/favicon/favicon_text.webp" alt="roomiedanmark Logo" class=" " style="height: 50px; object-fit: contain;">
        </a>
      </div>

      <div class="col-12 col-md-4 text-center text-md-end order-3 order-md-3 mt-4 mt-md-0">
        <ul class="nav justify-content-center justify-content-md-end gap-3">
          <li class="nav-item">
            <button type="button" class="nav-link p-0 text-muted border-0 bg-transparent footer-pseo-link fw-semibold" data-bs-toggle="modal" data-bs-target="#contactModal">
              Kontakt
            </button>
          </li>
          <li class="nav-item">
            <a href="/spoergsmaal-om-roomies" class="nav-link p-0 text-muted footer-pseo-link fw-semibold">Spørgsmål & Svar</a>
          </li>
          <li class="nav-item">
            <a href="/blog" class="nav-link p-0 text-muted footer-pseo-link fw-semibold">Blog</a>
          </li>
        </ul>
      </div>
    </div>

  </div>
</footer>
    `);
}
