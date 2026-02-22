// Write your JavaScript code.

(function () {
    "use strict";

    function $(id) { return document.getElementById(id); }

    // ---- Global layout: sidebar toggle ----
    function normalizePath(p) {
        var s = String(p || "");
        // strip query/hash
        var q = s.indexOf("?");
        if (q >= 0) s = s.substring(0, q);
        var h = s.indexOf("#");
        if (h >= 0) s = s.substring(0, h);
        // remove trailing slash (except root)
        if (s.length > 1 && s.endsWith("/")) s = s.substring(0, s.length - 1);
        return s.toLowerCase();
    }

    // NAV active state is server-rendered SSOT.
    // Client must NOT compute/toggle active classes or submenu visibility.
    function markActiveMenu() { }

    function applySidebarCollapsed(isCollapsed) {
        document.body.classList.toggle("sidebar-collapsed", !!isCollapsed);
        try { localStorage.setItem("app.sidebarCollapsed", isCollapsed ? "1" : "0"); } catch (e) { }
    }

    var THEMES = ["dark", "light", "modern"];
    var THEME_ICONS = { dark: "☀", light: "🌙", modern: "◆" };
    var DEFAULT_THEME = "dark";

    function normalizeTheme(t) {
        return THEMES.indexOf(t) >= 0 ? t : DEFAULT_THEME;
    }
    function getThemeIcon(theme) {
        return THEME_ICONS[normalizeTheme(theme)] || THEME_ICONS[DEFAULT_THEME];
    }
    /** 현재 테마가 없을 때 쓰일 직전 테마(첫 번째 다른 테마) */
    function getDefaultThemePrevious(currentTheme) {
        var cur = normalizeTheme(currentTheme);
        for (var i = 0; i < THEMES.length; i++) {
            if (THEMES[i] !== cur) return THEMES[i];
        }
        return DEFAULT_THEME;
    }
    function getTheme() {
        try { return normalizeTheme(document.documentElement.getAttribute("data-theme")) || DEFAULT_THEME; } catch (e) { return DEFAULT_THEME; }
    }
    function setTheme(theme) {
        theme = normalizeTheme(theme);
        document.documentElement.setAttribute("data-theme", theme);
        try { localStorage.setItem("app.theme", theme); } catch (e) { }
        var icon = document.getElementById("appThemeIcon");
        if (icon) icon.textContent = getThemeIcon(theme);
        var sel = document.getElementById("appThemeSelect");
        if (sel) sel.value = theme;
    }
    function getThemePrevious() {
        try {
            var prev = localStorage.getItem("app.themePrevious");
            if (prev && THEMES.indexOf(prev) >= 0) return prev;
            return getDefaultThemePrevious(getTheme());
        } catch (e) { return DEFAULT_THEME; }
    }
    function setThemePrevious(theme) {
        theme = normalizeTheme(theme);
        try { localStorage.setItem("app.themePrevious", theme); } catch (e) { }
    }
    function toggleThemeWithPrevious() {
        var current = getTheme();
        var prev = getThemePrevious();
        setTheme(prev);
        setThemePrevious(current);
    }
    function initThemeToggle() {
        var btn = document.getElementById("appThemeToggle");
        if (!btn) return;
        try {
            if (!localStorage.getItem("app.themePrevious")) {
                setThemePrevious(getDefaultThemePrevious(getTheme()));
            }
        } catch (e) { }
        var icon = document.getElementById("appThemeIcon");
        if (icon) icon.textContent = getThemeIcon(getTheme());
        btn.addEventListener("click", function () { toggleThemeWithPrevious(); });
    }
    window.appTheme = {
        get: getTheme,
        set: setTheme,
        getPrevious: getThemePrevious,
        setPrevious: setThemePrevious,
        toggle: toggleThemeWithPrevious
    };

    function initLayoutShell() {
        var btn = $("appSidebarToggle");
        var shell = $("appShell");
        if (!btn || !shell) return;

        initThemeToggle();
        // restore
        var collapsed = false;
        try { collapsed = localStorage.getItem("app.sidebarCollapsed") === "1"; } catch (e2) { }
        applySidebarCollapsed(collapsed);
        // active nav is rendered on the server; no JS sync needed

        btn.addEventListener("click", function () {
            applySidebarCollapsed(!document.body.classList.contains("sidebar-collapsed"));
        });
    }

    var ws = null;

    function getWsUrl() {
        var path = (window.wsTest && window.wsTest.endpointPath) ? window.wsTest.endpointPath : "/ws";
        var scheme = (location.protocol === "https:") ? "wss" : "ws";
        return scheme + "://" + location.host + path;
    }

    function setStatus(text) {
        var el = $("wsStatus");
        if (el) el.textContent = text;
    }

    function appendMessage(text) {
        var list = $("wsMessages");
        if (!list) return;

        var li = document.createElement("li");
        li.className = "list-group-item";
        li.textContent = text;
        list.appendChild(li);
        list.scrollTop = list.scrollHeight;
    }

    function connect() {
        if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
            return;
        }

        ws = new WebSocket(getWsUrl());

        setStatus("connecting...");

        ws.onopen = function () {
            setStatus("connected");
            appendMessage("[client] connected");
        };

        ws.onmessage = function (e) {
            appendMessage(e.data);
        };

        ws.onclose = function (e) {
            // e.reason 은 서버가 Close 프레임에 reason을 넣었을 때만 채워짐(대부분 비어있음)
            var reason = e && e.reason ? e.reason : "";
            var code = e && typeof e.code === "number" ? e.code : "";
            var wasClean = e && typeof e.wasClean === "boolean" ? e.wasClean : "";

            setStatus("disconnected");
            appendMessage("[client] disconnected"
                + (code !== "" ? (" (code=" + code + ")") : "")
                + (wasClean !== "" ? (" (clean=" + wasClean + ")") : "")
                + (reason ? (" (reason=" + reason + ")") : ""));
        };

        ws.onerror = function () {
            // WebSocket onerror는 상세 사유를 못 줌(표준/브라우저 정책)
            // 따라서 대표 원인 후보를 안내 문구로 제공
            var url = getWsUrl();
            appendMessage("[client] error (possible causes: server down, wrong ws path, blocked by firewall, mixed-content/https->ws issue, reverse proxy not allowing upgrade) (url=" + url + ")");
            setStatus("error");
        };
    }

    function disconnect() {
        if (!ws) return;
        try { ws.close(); } catch (e) { }
        ws = null;
    }

    function sendCurrentText() {
        var input = $("wsText");
        if (!input) return;

        var text = (input.value || "").trim();
        if (!text) return;

        if (!ws || ws.readyState !== WebSocket.OPEN) {
            appendMessage("[client] not connected; auto-connect");
            connect();
            setTimeout(function () {
                if (ws && ws.readyState === WebSocket.OPEN) {
                    ws.send(text);
                }
            }, 150);
        } else {
            ws.send(text);
        }

        input.value = "";
        input.focus();
    }

    document.addEventListener("DOMContentLoaded", function () {
        // layout init always
        initLayoutShell();

        if (!$("wsText") || !$("wsSend") || !$("wsMessages")) {
            return;
        }

        $("wsSend").addEventListener("click", sendCurrentText);
        $("wsConnect").addEventListener("click", connect);
        $("wsDisconnect").addEventListener("click", disconnect);

        $("wsText").addEventListener("keydown", function (e) {
            if (e.key === "Enter") {
                e.preventDefault();
                sendCurrentText();
            }
        });

        connect();
    });
})();