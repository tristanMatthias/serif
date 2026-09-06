(function () {
  var root = document.documentElement;

  function setTheme(t) {
    root.setAttribute("data-theme", t);
    try { localStorage.setItem("serif-theme", t); } catch (e) {}
  }

  function toggle() {
    setTheme(root.getAttribute("data-theme") === "dark" ? "light" : "dark");
  }

  var btn = document.getElementById("theme-toggle");
  if (btn) btn.addEventListener("click", toggle);

  document.addEventListener("keydown", function (e) {
    if (e.key === "t" && !e.metaKey && !e.ctrlKey && !e.altKey &&
        !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName) &&
        !document.activeElement.isContentEditable) {
      toggle();
    }
  });
})();
