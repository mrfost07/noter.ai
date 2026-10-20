(() => {
  "use strict";
  const root = document.documentElement.dataset.root;
  const menu = document.querySelector(".mobile-menu");
  const nav = document.querySelector(".primary-nav");
  const closeMenu = () => {
    nav.classList.remove("is-open");
    menu.setAttribute("aria-expanded", "false");
  };
  menu.addEventListener("click", () => {
    const open = menu.getAttribute("aria-expanded") !== "true";
    menu.setAttribute("aria-expanded", String(open));
    nav.classList.toggle("is-open", open);
  });
  nav.addEventListener("click", (e) => {
    if (e.target.closest("a")) closeMenu();
  });
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".site-header")) closeMenu();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && nav.classList.contains("is-open")) {
      closeMenu();
      menu.focus();
    }
  });
  matchMedia("(min-width: 721px)").addEventListener("change", closeMenu);

  function tabs(buttons, select) {
    buttons.forEach((button, index) => {
      button.addEventListener("click", () => select(button));
      button.addEventListener("keydown", (e) => {
        let next;
        if (e.key === "ArrowRight") next = (index + 1) % buttons.length;
        if (e.key === "ArrowLeft") next = (index - 1 + buttons.length) % buttons.length;
        if (e.key === "Home") next = 0;
        if (e.key === "End") next = buttons.length - 1;
        if (next === undefined) return;
        e.preventDefault();
        select(buttons[next]);
        buttons[next].focus();
      });
    });
  }
  const platformButtons = [...document.querySelectorAll("[data-platform]")];
  if (platformButtons.length) {
    const select = (button) => {
      platformButtons.forEach((b) => {
        const active = b === button;
        b.setAttribute("aria-selected", String(active));
        b.tabIndex = active ? 0 : -1;
        document.getElementById(`platform-${b.dataset.platform}`).hidden = !active;
      });
    };
    tabs(platformButtons, (button) => {
      select(button);
      history.replaceState(null, "", `#${button.dataset.platform}`);
    });
    const hash = location.hash.slice(1);
    const platform = /Mac|iPhone|iPad/.test(navigator.platform)
      ? "macos"
      : /Linux/.test(navigator.platform) && !/Android/.test(navigator.userAgent)
        ? "linux"
        : "windows";
    select(platformButtons.find((b) => b.dataset.platform === hash) || platformButtons.find((b) => b.dataset.platform === platform));
  }
  const screenshotTabs = [...document.querySelectorAll("[data-screenshot-tab]")];
  if (screenshotTabs.length) {
    const selectScreenshot = (button) =>
      screenshotTabs.forEach((b) => {
        const active = b === button;
        b.setAttribute("aria-selected", String(active));
        b.tabIndex = active ? 0 : -1;
        document.getElementById(`${b.dataset.screenshotTab}-view`).hidden = !active;
      });
    tabs(screenshotTabs, selectScreenshot);
    selectScreenshot(screenshotTabs[0]);
  }
  const imageDialog = document.querySelector(".image-dialog");
  document.querySelectorAll("[data-expand-image]").forEach((button) =>
    button.addEventListener("click", () => {
      const image = imageDialog.querySelector("img");
      image.src = `${root}assets/${button.dataset.expandImage}`;
      image.alt = button.dataset.imageDescription;
      imageDialog.querySelector(".image-description").textContent = button.dataset.imageDescription;
      imageDialog.showModal();
    }),
  );
  document.querySelector("[data-close-image]").addEventListener("click", () => imageDialog.close());
  imageDialog.addEventListener("click", (e) => {
    if (e.target === imageDialog) {
      const r = imageDialog.getBoundingClientRect();
      if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) imageDialog.close();
    }
  });

  const search = document.querySelector(".search-dialog");
  const field = document.getElementById("docs-search");
  const list = document.querySelector(".search-results");
  const status = document.querySelector(".search-status");
  let index, pendingIndex, searchError;
  async function loadIndex() {
    if (index) return index;
    if (!pendingIndex)
      pendingIndex = fetch(`${root}assets/search-index.json`)
        .then((r) => {
          if (!r.ok) throw new Error("Search unavailable");
          return r.json();
        })
        .then((data) => {
          index = data;
          searchError = false;
          return data;
        })
        .catch(() => {
          searchError = true;
          pendingIndex = null;
          return [];
        });
    return pendingIndex;
  }
  function showResults() {
    const query = field.value.trim().toLowerCase();
    const tokens = query.split(/\s+/).filter(Boolean);
    list.replaceChildren();
    if (searchError) {
      status.textContent = "Search could not load. Check your connection and reopen search to retry.";
      return;
    }
    const results = (index || [])
      .map((a) => {
        const title = a.title.toLowerCase(),
          all = `${title} ${a.description} ${a.text}`.toLowerCase();
        return {
          ...a,
          score: tokens.length
            ? tokens.every((t) => all.includes(t))
              ? tokens.reduce((s, t) => s + (title.includes(t) ? 5 : 1), 0)
              : 0
            : 1,
        };
      })
      .filter((a) => a.score)
      .sort((a, b) => b.score - a.score)
      .slice(0, 8);
    status.textContent = query
      ? `${results.length}${results.length === 8 ? "+" : ""} ${results.length === 1 ? "guide" : "guides"} found.`
      : "Start with a guide below.";
    results.forEach((a) => {
      const li = document.createElement("li"),
        link = document.createElement("a");
      link.href = `${root}docs/${a.slug}/`;
      const group = document.createElement("small"),
        title = document.createElement("strong"),
        description = document.createElement("p");
      group.textContent = a.group;
      title.textContent = a.title;
      description.textContent = a.description;
      link.append(group, title, description);
      li.append(link);
      list.append(li);
    });
    if (query && !results.length) {
      const li = document.createElement("li"),
        link = document.createElement("a");
      link.href = `${root}docs/`;
      link.textContent = "No exact match. Browse all documentation →";
      li.append(link);
      list.append(li);
    }
  }
  async function openSearch() {
    if (search.open) {
      field.focus();
      return;
    }
    search.showModal();
    field.focus();
    status.textContent = "Loading guides…";
    await loadIndex();
    showResults();
  }
  document.querySelectorAll("[data-open-search]").forEach((b) => b.addEventListener("click", openSearch));
  document.querySelector("[data-close-search]").addEventListener("click", () => search.close());
  field.addEventListener("input", showResults);
  search.addEventListener("click", (e) => {
    if (e.target === search) {
      const r = search.getBoundingClientRect();
      if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) search.close();
    }
  });
  search.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      search.close();
      return;
    }
    if (!["ArrowDown", "ArrowUp"].includes(e.key)) return;
    const links = [...list.querySelectorAll("a")];
    if (!links.length) return;
    e.preventDefault();
    const current = links.indexOf(document.activeElement);
    if (e.key === "ArrowUp" && current === 0) field.focus();
    else links[(current + (e.key === "ArrowDown" ? 1 : -1) + links.length) % links.length].focus();
  });
  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      openSearch();
    }
  });
  if (/Mac|iPhone|iPad/.test(navigator.platform))
    document.querySelectorAll("kbd").forEach((k) => {
      k.textContent = k.textContent.replace("Ctrl", "⌘");
    });

  document.querySelectorAll(".prose pre").forEach((pre) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "copy-code";
    button.textContent = "Copy";
    button.setAttribute("aria-label", "Copy code");
    button.setAttribute("aria-live", "polite");
    button.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(pre.querySelector("code").textContent);
        button.textContent = "Copied";
      } catch {
        button.textContent = "Select code to copy";
      }
      setTimeout(() => {
        button.textContent = "Copy";
      }, 2500);
    });
    pre.append(button);
  });
  const videoDialog = document.querySelector(".video-dialog"),
    video = videoDialog.querySelector("video");
  document.querySelectorAll("[data-open-video]").forEach((b) =>
    b.addEventListener("click", () => {
      videoDialog.showModal();
      video.play().catch(() => {});
    }),
  );
  document.querySelector("[data-close-video]").addEventListener("click", () => videoDialog.close());
  videoDialog.addEventListener("close", () => video.pause());
  videoDialog.addEventListener("click", (e) => {
    if (e.target === videoDialog) {
      const r = videoDialog.getBoundingClientRect();
      if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) videoDialog.close();
    }
  });
  const toc = [...document.querySelectorAll('.doc-toc a[href^="#"]')];
  if (toc.length && "IntersectionObserver" in window) {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) toc.forEach((a) => a.classList.toggle("is-current", a.hash === `#${entry.target.id}`));
        });
      },
      { rootMargin: "-90px 0px -65% 0px" },
    );
    toc.forEach((a) => {
      const target = document.getElementById(a.hash.slice(1));
      if (target) observer.observe(target);
    });
  }
})();
