(function WebSocket() {
    "use strict";

    function el(id) { return document.getElementById(id); }

    function renderStatus(list) {
        var host = el("pcList");
        if (!host) return;
        host.innerHTML = "";

        for (var i = 0; i < list.length; i++) {
    r x = list[i];

            var row = document.createElement("div");
            row.className = "pc-row";

            var no = document.createElement("div");
            no.className = "pc-no";
            no.textContent = x.pcNo;

            var dot = document.createElement("span");
            dot.className = "dot " + (x.online ? "green" : "red");

            var meta = document.createElement("div");
            meta.className = "meta";
            meta.textContent = x.online
                ? ("online (" + x.remoteIp + ":" + x.remotePort + ")")
                : "offline";

            var msg = document.createElement("div");
            msg.className = "msg";
            msg.textContent = x.lastMessage || "";

            row.appendChild(no);
            row.appendChild(dot);
            row.appendChild(meta);
            row.appendChild(msg);
            host.appendChild(row);
        }
    }

    async function refreshStatus() {
        try {
            if (!el("pcList")) return;
            var res = await fetch("/WebSocket/WsCheck?handler=Status", { cache: "no-store" });
            if (!res.ok) return;
            var data = await res.json();
            renderStatus(data);
        } catch { }
    }

    document.addEventListener("DOMContentLoaded", function () {
        refreshStatus();
        setInterval(refreshStatus, 1000);
    });
})();
