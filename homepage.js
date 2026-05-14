(function () {
    const header = document.querySelector("[data-header]");
    const menuToggle = document.querySelector("[data-menu-toggle]");
    const navPanel = document.querySelector("[data-nav-panel]");
    const successEl = document.getElementById("success-message");
    const form = document.querySelector(".contact-form");

    function setHeaderState() {
        if (!header) return;
        header.classList.toggle("is-scrolled", window.scrollY > 18);
    }

    function closeMenu() {
        if (!menuToggle || !navPanel) return;
        menuToggle.setAttribute("aria-expanded", "false");
        navPanel.classList.remove("is-open");
        document.body.classList.remove("menu-open");
    }

    setHeaderState();
    window.addEventListener("scroll", setHeaderState, { passive: true });

    if (menuToggle && navPanel) {
        menuToggle.addEventListener("click", function () {
            const isOpen = navPanel.classList.toggle("is-open");
            menuToggle.setAttribute("aria-expanded", String(isOpen));
            document.body.classList.toggle("menu-open", isOpen);
        });

        navPanel.addEventListener("click", function (event) {
            const target = event.target;
            if (target instanceof HTMLAnchorElement) {
                closeMenu();
            }
        });
    }

    document.querySelectorAll('a[href^="#"]').forEach(function (link) {
        link.addEventListener("click", function (event) {
            const id = link.getAttribute("href");
            if (!id || id === "#") return;

            const target = document.querySelector(id);
            if (!target) return;

            event.preventDefault();
            target.scrollIntoView({ behavior: "smooth", block: "start" });
            history.pushState(null, "", id);
        });
    });

    const revealItems = document.querySelectorAll(".reveal");
    if ("IntersectionObserver" in window) {
        const observer = new IntersectionObserver(function (entries) {
            entries.forEach(function (entry) {
                if (entry.isIntersecting) {
                    entry.target.classList.add("is-visible");
                    observer.unobserve(entry.target);
                }
            });
        }, { threshold: 0.12 });

        revealItems.forEach(function (item) {
            observer.observe(item);
        });
    } else {
        revealItems.forEach(function (item) {
            item.classList.add("is-visible");
        });
    }

    if (form) {
        form.addEventListener("submit", function (event) {
            event.preventDefault();

            const formData = new FormData(form);
            if (!formData.has("form-name")) {
                formData.append("form-name", form.getAttribute("name") || "contact");
            }

            fetch(form.getAttribute("action") || "/", {
                method: "POST",
                headers: { "Content-Type": "application/x-www-form-urlencoded" },
                body: new URLSearchParams(formData).toString()
            })
                .then(function (response) {
                    if ((response.status >= 200 && response.status < 300) || response.status === 303 || response.redirected) {
                        if (successEl) successEl.classList.add("is-visible");
                        form.reset();
                        return;
                    }
                    throw new Error("Submission failed with status " + response.status);
                })
                .catch(function () {
                    alert("An error occurred while submitting the form. Please try again.");
                });
        });
    }
})();
