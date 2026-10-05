(() => {
  const $ = (sel) => document.querySelector(sel);
  const isHttp = (u) => typeof u === "string" && /^https?:\/\//i.test(u);
  const el = (tag, props = {}, ...children) => {
    const node = document.createElement(tag);
    Object.entries(props).forEach(([k, v]) => {
      if (k === "class") node.className = v;
      else if (k === "text") node.textContent = v;
      else node.setAttribute(k, v);
    });
    children.forEach((c) => c && node.append(c));
    return node;
  };

  $("#year").textContent = new Date().getFullYear();

  let config = {};
  const ready = fetch("/site.config.json", { cache: "no-cache" })
    .then((r) => r.json())
    .then((c) => (config = c))
    .catch(() => (config = {}));

  // ---------- Social links + project cards ----------
  ready.then(() => {
    const social = $("#social");
    (config.social || []).filter((s) => isHttp(s.url)).forEach((s) => {
      social.append(el("li", {}, el("a", { href: s.url, rel: "me noopener", target: "_blank", text: s.label })));
    });

    const sites = $("#sites");
    (config.sites || []).filter((s) => isHttp(s.url)).forEach((s) => {
      sites.append(
        el("li", {},
          el("a", { class: "card", href: s.url, target: "_blank", rel: "noopener" },
            s.tag ? el("span", { class: "tag", text: s.tag }) : null,
            el("h3", { text: s.title }),
            s.description ? el("p", { text: s.description }) : null,
            el("span", { class: "go", text: "Visit" })
          )
        )
      );
    });
  });

  // ---------- Article feed ----------
  const feedList = $("#feed");
  const filters = $("#filters");
  const dateFmt = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" });
  let items = [];
  let active = "All";

  function renderFeed() {
    feedList.replaceChildren();
    const shown = active === "All" ? items : items.filter((i) => i.source === active);
    if (!shown.length) {
      feedList.append(el("li", { class: "feed-empty", text: "No articles to show yet." }));
      return;
    }
    shown.forEach((it) => {
      const hasImg = isHttp(it.image);
      const meta = el("div", { class: "meta" },
        el("span", { class: "src", text: it.source || "" }),
        it.date ? el("time", { datetime: it.date, text: dateFmt.format(new Date(it.date)) }) : null
      );
      const text = el("div", {}, meta, el("h3", { text: it.title }), it.summary ? el("p", { text: it.summary }) : null);
      const link = el("a", { href: it.link, target: "_blank", rel: "noopener", class: hasImg ? "" : "no-img" }, text);
      if (hasImg) link.append(el("img", { src: it.image, alt: "", loading: "lazy", decoding: "async" }));
      feedList.append(el("li", { class: "feed-item" }, link));
    });
  }

  function renderFilters() {
    const sources = [...new Set(items.map((i) => i.source).filter(Boolean))];
    filters.replaceChildren();
    if (sources.length < 2) return;
    ["All", ...sources].forEach((name) => {
      const b = el("button", { type: "button", "aria-pressed": String(name === active), text: name });
      b.addEventListener("click", () => {
        active = name;
        filters.querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
        renderFeed();
      });
      filters.append(b);
    });
  }

  fetch("/api/feed")
    .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
    .then((data) => {
      items = (data.items || []).filter((i) => isHttp(i.link) && i.title);
      renderFilters();
      renderFeed();
    })
    .catch(() => {
      feedList.replaceChildren(el("li", { class: "feed-empty", text: "Couldn’t load articles right now." }));
    });

  // ---------- Contact form ----------
  const form = $("#contact-form");
  const status = $("#form-status");
  const setStatus = (msg, kind = "") => { status.textContent = msg; status.className = `status ${kind}`; };

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    await ready;

    let valid = true;
    form.querySelectorAll("[required]").forEach((f) => {
      const ok = f.checkValidity() && f.value.trim() !== "";
      f.setAttribute("aria-invalid", String(!ok));
      if (!ok) valid = false;
    });
    if (!valid) return setStatus("Please fill in all fields with a valid email.", "err");

    const contact = config.contact || {};
    if (!contact.accessKey || /^YOUR_/.test(contact.accessKey)) {
      return setStatus("Contact form isn’t configured yet.", "err");
    }

    const fd = new FormData(form);
    if (fd.get("botcheck")) return; // honeypot tripped

    const payload = {
      access_key: contact.accessKey,
      subject: contact.subject || "New message from your website",
      from_name: fd.get("name"),
      name: fd.get("name"),
      email: fd.get("email"),
      message: fd.get("message"),
      botcheck: "",
    };

    const btn = form.querySelector("button[type=submit]");
    btn.disabled = true;
    setStatus("Sending…");
    try {
      const res = await fetch(contact.endpoint || "https://api.web3forms.com/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(payload),
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok || out.success === false) throw new Error(out.message || res.status);
      form.reset();
      form.querySelectorAll("[aria-invalid]").forEach((f) => f.removeAttribute("aria-invalid"));
      setStatus("Thanks — your message is on its way.", "ok");
    } catch {
      setStatus("Something went wrong. Please try again in a moment.", "err");
    } finally {
      btn.disabled = false;
    }
  });
})();
