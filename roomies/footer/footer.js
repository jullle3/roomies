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

<footer class="border-top pt-5 pb-4 bg-light" style="font-family: 'Lato', sans-serif;">
  <div class="container" style="max-width: 1500px;">
    
    <div class="row align-items-center">
        <div class="col-12 col-md-4 text-center text-md-start order-2 order-md-1">
          <div class="mb-3 d-flex justify-content-center justify-content-md-start gap-3">
            <a href="https://www.facebook.com/profile.php?id=61577566727957" target="_blank" aria-label="Følg os på Facebook" class="text-decoration-none footer-social-link footer-social-link-facebook">
              <i class="fa-brands fa-facebook fs-4" style="line-height: 1"></i>
            </a>
            <a href="https://www.instagram.com/andelsbolig_basen/?hl=da" target="_blank" aria-label="Følg os på Instagram" class="text-decoration-none footer-social-link footer-social-link-instagram">
              <i class="fa-brands fa-instagram fs-4" style="line-height: 1"></i>
            </a>
          </div>
          <small class="text-muted fw-medium">
            &copy; ${currentYear} roomies
          </small>
        </div>

      <div class="col-12 col-md-4 text-center order-1 order-md-2 mb-4 mb-md-0">
        <a href="/" class="d-inline-block hover-lift" style="transition: transform 0.2s cubic-bezier(0.4, 0, 0.2, 1);">
          <img src="${basePath}/favicon/android-chrome-192x192.webp" alt="roomies Logo" class="footer-logo rounded-4 shadow-sm" style="height: 50px; object-fit: contain;">
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
            <a href="/spoergsmaal-om-andelsbolig" class="nav-link p-0 text-muted footer-pseo-link fw-semibold">Spørgsmål & Svar</a>
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
