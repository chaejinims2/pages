(function () {
    "use strict";

    function $(id) { return document.getElementById(id); }

    // ---- config ----
    var STALE_WARN_MS = 30 * 1000;
    var STALE_OFFLINE_MS = 60 * 1000;
    var MAX_LOG_LINES = 500;
    var LOG_STORAGE_KEY = "dashboard.log.lines";

    // Config.txt 기반 레이아웃/스케일
    var sysCfg = {
        startChamber: 1,
        maxChamber: 1,
        boardRows: 1,
        boardCols: 1,
        portRows: 1,
        portCols: 1,
        boardsPerChamber: 1, // boardRows * boardCols
        portsPerBoard: 1,    // portRows * portCols
        isDuts: true         // true: 보드당 포트1, 포트2 / false: 보드당 포트0만
    };

    // 챔버 선택(탭)
    var selectedChamber = 1;

    // ---- WS/state ----
    var ws = null;
    var wsRemainder = "";
    var targets = new Map(); // key="pc:port" -> target state
    var selectedKeysDuts = new Set();   // isDuts true일 때 선택 (보드:포트1, 포트2)
    var selectedKeysNoDuts = new Set(); // isDuts false일 때 선택 (보드:포트0)
    var pendingSendQueue = new Map(); // key="pc:port" -> { msg } (disconnected일 때 대기, 재연결 시 전송)
    var lastSelectedKey = null; // 선택된 대상 중 "가장 최근 활성화(ON)" (TEST에서 Dut/Board/Port 표시용)

    function getSelectedKeys() { return sysCfg.isDuts ? selectedKeysDuts : selectedKeysNoDuts; }

    // ---- persistence (refresh 유지) ----
    var STORAGE_KEY = "wsDashboardState.v2";
    var persistTimer = null;

    function nowMs() { return Date.now(); }

    function keyOf(pc, port) { return String(pc) + ":" + String(port); }

    /** isDuts일 때 보드당 포트 [1,2,...], 아닐 때 [0] */
    function portListForBoard() {
        if (sysCfg.isDuts) {
            var arr = [];
            for (var p = 1; p <= Math.max(1, sysCfg.portsPerBoard); p++) arr.push(p);
            return arr;
        }
        return [0];
    }

    function getWsUrl() {
        var w = window.dashboard || window.wsDashboard;
        var path = (w && w.endpointPath) ? w.endpointPath : "/ws";
        var scheme = (location.protocol === "https:") ? "wss" : "ws";
        return scheme + "://" + location.host + path;
    }

    function getSection() {
        var w = window.dashboard || window.wsDashboard;
        var s = (w && w.section) ? String(w.section) : "";
        s = (s || "").trim().toUpperCase();
        return s || "TEST";
    }

    // 섹션별 선택 단위
    // - TEST, DPS: 포트 단위 선택
    // - TPC, DIAG, UPDATE: 보드 단위 선택
    function getSelectionMode() {
        var s = getSection();
        if (s === "TPC" || s === "DIAG" || s === "UPDATE") return "board";
        return "port";
    }

    function parseKey(key) {
        if (!key) return null;
        var parts = String(key).split(":");
        if (parts.length < 2) return null;
        var pc = parseInt(parts[0], 10);
        var port = parseInt(parts[1], 10);
        if (!Number.isFinite(pc) || !Number.isFinite(port)) return null;
        return { pc: pc, port: port };
    }

    function lastOfSet(set) {
        if (!set || set.size === 0) return null;
        // Set은 insertion order 유지 → "마지막으로 활성화된" 항목이 끝에 위치
        var arr = Array.from(set);
        return arr[arr.length - 1] || null;
    }

    function syncTestLastSelectionInputs() {
        // DashboardTest에서만 보이는 입력들
        var dutEl = document.getElementById("testDutNumber");
        var boardEl = document.getElementById("testBoardNumber");
        var portEl = document.getElementById("testPortNumber");
        if (!dutEl || !boardEl || !portEl) return;

        // TEST(Port Status) 화면에서만 갱신
        if (getSection() !== "TEST") return;

        var keys = getSelectedKeys();
        if (!keys || keys.size === 0) {
            dutEl.value = "0";
            boardEl.value = "0";
            portEl.value = "0";
            lastSelectedKey = null;
            return;
        }

        // lastSelectedKey가 비었거나 selection에서 빠졌으면 Set의 마지막 값으로 보정
        if (!lastSelectedKey || !keys.has(lastSelectedKey)) {
            var arr = Array.from(keys);
            lastSelectedKey = arr[arr.length - 1];
        }

        var parsed = parseKey(lastSelectedKey);
        if (!parsed) return;
        boardEl.value = String(parsed.pc);
        portEl.value = String(parsed.port);
        // "#<number>"에서 number만: deviceNoFor 결과가 DUT number
        dutEl.value = String(deviceNoFor(parsed.pc, parsed.port));
    }

    function fmtTime(ms) {
        if (!ms) return "-";
        var d = new Date(ms);
        var hh = String(d.getHours()).padStart(2, "0");
        var mm = String(d.getMinutes()).padStart(2, "0");
        var ss = String(d.getSeconds()).padStart(2, "0");
        return hh + ":" + mm + ":" + ss;
    }

    // 로그: 한 곳에서 관리. sessionStorage에 저장해 섹션 전환 후에도 유지.
    var logLines = [];

    function loadLogFromStorage() {
        try {
            var raw = sessionStorage.getItem(LOG_STORAGE_KEY);
            if (raw) {
                var parsed = JSON.parse(raw);
                if (Array.isArray(parsed)) logLines = parsed.slice(-MAX_LOG_LINES);
            }
        } catch (e) { logLines = []; }
    }

    function saveLogToStorage() {
        try { sessionStorage.setItem(LOG_STORAGE_KEY, JSON.stringify(logLines)); } catch (e) { }
    }

    function syncLogToDom() {
        var box = $("dashLogBox");
        if (!box) return;
        box.textContent = logLines.join("\n");
        box.scrollTop = box.scrollHeight;
    }

    function appendLog(line) {
        logLines.push(line);
        if (logLines.length > MAX_LOG_LINES) logLines = logLines.slice(logLines.length - MAX_LOG_LINES);
        saveLogToStorage();
        var box = $("dashLogBox");
        if (box) {
            box.textContent = logLines.join("\n");
            box.scrollTop = box.scrollHeight;
        }
    }

    loadLogFromStorage();

    // ---- chamber helpers ----
    function chamberList() {
        var start = Math.max(1, sysCfg.startChamber || 1);
        var count = Math.max(1, sysCfg.maxChamber || 1);
        var out = [];
        for (var ch = start; ch < start + count; ch++) out.push(ch);
        return out;
    }

    function boardRangeForChamber(chamberIndex) {
        var bpc = Math.max(1, sysCfg.boardsPerChamber || 1);
        var startPc = (bpc * (chamberIndex - 1)) + 1;
        var endPc = startPc + bpc - 1;
        return { startPc: startPc, endPc: endPc };
    }

    function isEditingText() {
        var el = document.activeElement;
        if (!el) return false;
        var tag = (el.tagName || "").toUpperCase();
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
        if (el.isContentEditable) return true;
        return false;
    }

    function moveChamberBy(delta) {
        var list = chamberList();
        if (!list.length) return;
        var idx = list.indexOf(selectedChamber);
        if (idx < 0) idx = 0;
        var next = (idx + delta) % list.length;
        if (next < 0) next += list.length;
        selectChamber(list[next], true);
    }

    function bindChamberHotkeys() {
        document.addEventListener("keydown", function (e) {
            if (isEditingText()) return;
            if (!e) return;
            if (e.ctrlKey && !e.altKey && !e.metaKey && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
                e.preventDefault();
                moveChamberBy(e.key === "ArrowRight" ? +1 : -1);
                return;
            }
            if (e.ctrlKey && !e.altKey && !e.metaKey && e.key === "Tab") {
                e.preventDefault();
                moveChamberBy(e.shiftKey ? -1 : +1);
                return;
            }
        });
    }

    function selectChamber(ch, renderNow) {
        selectedChamber = parseInt(String(ch), 10);
        if (!Number.isFinite(selectedChamber)) selectedChamber = Math.max(1, sysCfg.startChamber || 1);
        if (window.BoardPortStatus) {
            BoardPortStatus.setChamberButtonsActive($("dashChamberButtons"));
            BoardPortStatus.ensureBuilt(true);
            BoardPortStatus.requestGridFit();
        }
        schedulePersist();
        if (renderNow !== false) renderAll();
    }

    // ---- persistence ----
    function schedulePersist() {
        if (persistTimer) return;
        persistTimer = setTimeout(function () {
            persistTimer = null;
            persistState();
        }, 300);
    }

    function persistState() {
        try {
            var pcs = {};   // pc -> { lastSeenMs, modelName, version }
            var ports = {}; // key -> { jobState, provState, lastMessage }
            targets.forEach(function (t) {
                var pcKey = String(t.pc);
                if (!pcs[pcKey]) pcs[pcKey] = { lastSeenMs: 0, modelName: "", version: "" };
                if (t.lastSeenMs && t.lastSeenMs > pcs[pcKey].lastSeenMs) pcs[pcKey].lastSeenMs = t.lastSeenMs;
                if (t.modelName && !pcs[pcKey].modelName) pcs[pcKey].modelName = t.modelName;
                if (t.version && !pcs[pcKey].version) pcs[pcKey].version = t.version;

                ports[t.key] = {
                    jobState: t.jobState || "UNKNOWN",
                    provState: t.provState || "UNKNOWN",
                    lastMessage: t.lastMessage || ""
                };
            });

            var payload = {
                v: 2,
                savedAtMs: nowMs(),
                cfg: {
                    startChamber: sysCfg.startChamber,
                    maxChamber: sysCfg.maxChamber,
                    boardRows: sysCfg.boardRows,
                    boardCols: sysCfg.boardCols,
                    portRows: sysCfg.portRows,
                    portCols: sysCfg.portCols
                },
                ui: {
                    selectedChamber: selectedChamber,
                    selectedKeysDuts: Array.from(selectedKeysDuts),
                    selectedKeysNoDuts: Array.from(selectedKeysNoDuts)
                },
                pcs: pcs,
                ports: ports
            };
            localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
        } catch (e) { }
    }

    function restoreState() {
        try {
            var raw = localStorage.getItem(STORAGE_KEY);
            if (!raw) return;
            var obj = JSON.parse(raw);
            if (!obj || obj.v !== 2) return;
            if (obj.savedAtMs && (nowMs() - obj.savedAtMs) > 24 * 60 * 60 * 1000) return;

            if (obj.ui && obj.ui.selectedChamber) {
                var ch = parseInt(String(obj.ui.selectedChamber), 10);
                if (Number.isFinite(ch)) selectedChamber = ch;
            }
            if (obj.ui) {
                if (obj.ui.selectedKeysDuts && Array.isArray(obj.ui.selectedKeysDuts)) {
                    selectedKeysDuts.clear();
                    obj.ui.selectedKeysDuts.forEach(function (k) { if (k) selectedKeysDuts.add(String(k)); });
                }
                if (obj.ui.selectedKeysNoDuts && Array.isArray(obj.ui.selectedKeysNoDuts)) {
                    selectedKeysNoDuts.clear();
                    obj.ui.selectedKeysNoDuts.forEach(function (k) { if (k) selectedKeysNoDuts.add(String(k)); });
                }
                // 이전 저장 형식 호환: selectedKeys가 있으면 두 셋 모두에 복원
                if (!obj.ui.selectedKeysDuts && !obj.ui.selectedKeysNoDuts && obj.ui.selectedKeys && Array.isArray(obj.ui.selectedKeys)) {
                    selectedKeysDuts.clear();
                    selectedKeysNoDuts.clear();
                    obj.ui.selectedKeys.forEach(function (k) {
                        if (k) {
                            var s = String(k);
                            selectedKeysDuts.add(s);
                            selectedKeysNoDuts.add(s);
                        }
                    });
                } else if (obj.ui.selectedKey) {
                    var one = String(obj.ui.selectedKey);
                    selectedKeysDuts.clear();
                    selectedKeysNoDuts.clear();
                    selectedKeysDuts.add(one);
                    selectedKeysNoDuts.add(one);
                }
            }

            if (obj.pcs) {
                Object.keys(obj.pcs).forEach(function (pcKey) {
                    var pc = parseInt(pcKey, 10);
                    if (!Number.isFinite(pc)) return;
                    var pcObj = obj.pcs[pcKey];
                    if (!pcObj) return;
                    if (pcObj.modelName) setBoardModel(pc, pcObj.modelName);
                    if (pcObj.version) setBoardVersion(pc, pcObj.version);
                    if (pcObj.lastSeenMs) {
                        var plist = portListForBoard();
                        for (var pi = 0; pi < plist.length; pi++) {
                            var t = getOrCreateTarget(pc, plist[pi]);
                            t.lastSeenMs = pcObj.lastSeenMs;
                        }
                    }
                });
            }
            if (obj.ports) {
                Object.keys(obj.ports).forEach(function (k) {
                    var v = obj.ports[k];
                    if (!v) return;
                    var parts = k.split(":");
                    if (parts.length !== 2) return;
                    var pc = parseInt(parts[0], 10);
                    var port = parseInt(parts[1], 10);
                    if (!Number.isFinite(pc) || !Number.isFinite(port) || port < 0) return;
                    var t = getOrCreateTarget(pc, port);
                    if (v.jobState) t.jobState = v.jobState;
                    if (v.provState) t.provState = v.provState;
                    if (v.lastMessage) t.lastMessage = v.lastMessage;
                });
            }
        } catch (e) { }
    }

    // ---- parsing ----
    function drainFramesFromRemainder(appendedText) {
        if (appendedText) wsRemainder += String(appendedText);
        var out = [];
        while (true) {
            var start = wsRemainder.indexOf("<");
            if (start < 0) {
                wsRemainder = "";
                break;
            }
            if (start > 0) {
                wsRemainder = wsRemainder.substring(start);
                start = 0;
            }
            var end = wsRemainder.indexOf(">", start + 1);
            if (end < 0) break;
            var body = wsRemainder.substring(start + 1, end);
            out.push(body);
            wsRemainder = wsRemainder.substring(end + 1);
            if (wsRemainder.length > 200000) {
                var lastGt = wsRemainder.lastIndexOf(">");
                wsRemainder = (lastGt >= 0) ? wsRemainder.substring(lastGt + 1) : "";
                break;
            }
        }
        return out;
    }

    function parseFrame(frameBody) {
        var parts = frameBody.split(",");
        if (parts.length < 6) return null;
        var mode = parseInt(parts[0], 10);
        var pc = parseInt(parts[1], 10);
        var port = parseInt(parts[2], 10);
        var msg = parseInt(parts[3], 10);
        var packet = parseInt(parts[4], 10);
        var flag = parseInt(parts[5], 10);
        var data = (parts.length >= 7) ? parts.slice(6).join(",").trim() : "";
        if ([mode, pc, port, msg].some(function (n) { return Number.isNaN(n); })) return null;
        return { mode: mode, pc: pc, port: port, msg: msg, packet: packet || 0, flag: flag || 0, data: data };
    }

    function directionOf(p) {
        if (!p) return "unknown";
        // heartbeat(<0,pc,0,0,0,0,>)는 별도 처리
        if (p.mode === 0) return "ui";
        if (p.msg === 1 && p.data && (p.data.indexOf("exec/") >= 0 || p.data.indexOf("share/") >= 0)) return "ui";
        return "board";
    }

    function looksLikeBoardModelName(s) {
        if (!s) return false;
        var t = String(s).trim();
        if (!t) return false;
        if (t.toUpperCase() === "EMPTY") return false;
        if (t.length < 6) return false;
        // 대략: "X5-BSEBD-QFA-1882" 같은 패턴
        return (t.indexOf("-") >= 0) && !/\s/.test(t);
    }

    // ---- state mutations ----
    function getOrCreateTarget(pc, port) {
        if (port == null || port === undefined) port = sysCfg.isDuts ? 1 : 0;
        else if (sysCfg.isDuts && port <= 0) port = 1;
        var key = keyOf(pc, port);
        if (targets.has(key)) return targets.get(key);
        var t = {
            key: key,
            pc: pc,
            port: port,
            lastSeenMs: 0,
            firstSeenMs: 0,
            lastUiSendMs: 0,
            lastMessage: "",
            version: "",
            modelName: "",
            lastMode: 0,
            run: { startedAtMs: 0, command: "", hasPass: false, hasFail: false, hasError: false },
            // 3-axis states
            provState: "UNKNOWN",  // UNKNOWN | PRESENT | EMPTY
            jobState: "UNKNOWN",   // READY | IDLE | QUEUED | STARTING | RUNNING | FAIL | MANUALFAIL | BLOCKED | UNKNOWN
            jobChangedMs: 0
        };
        targets.set(key, t);
        return t;
    }

    function ensurePresent(t) {
        if (!t) return;
        if (t.provState === "UNKNOWN") {
            t.provState = "PRESENT";
            t.firstSeenMs = t.firstSeenMs || nowMs();
        }
    }

    function setJobState(t, next) {
        if (!t) return;
        if (t.jobState !== next) {
            t.jobState = next;
            t.jobChangedMs = nowMs();
        }
    }

    function setBoardVersion(pc, ver) {
        if (!ver) return;
        var plist = portListForBoard();
        for (var i = 0; i < plist.length; i++) {
            getOrCreateTarget(pc, plist[i]).version = ver;
        }
        schedulePersist();
    }

    function setBoardModel(pc, model) {
        if (!model) return;
        var plist = portListForBoard();
        for (var i = 0; i < plist.length; i++) {
            getOrCreateTarget(pc, plist[i]).modelName = model;
        }
        schedulePersist();
    }

    function markBoardAlive(pc) {
        var plist = portListForBoard();
        var ts = nowMs();
        for (var i = 0; i < plist.length; i++) {
            var t = getOrCreateTarget(pc, plist[i]);
            t.lastSeenMs = ts;
            ensurePresent(t);
            if (t.jobState === "UNKNOWN") setJobState(t, "IDLE");
        }
        schedulePersist();
    }

    function applyParsedToSingleTarget(p, rawText, pc, port) {
        updateFromParsed({ mode: p.mode, pc: pc, port: port, msg: p.msg, packet: p.packet, flag: p.flag, data: p.data }, rawText);
    }

    function updateFromParsedWithFanOut(p, rawText) {
        if (p && p.port === 0) {
            var plist = portListForBoard();
            for (var i = 0; i < plist.length; i++) applyParsedToSingleTarget(p, rawText, p.pc, plist[i]);
            return;
        }
        updateFromParsed(p, rawText);
    }

    function updateFromParsed(p, rawText) {
        var dir = directionOf(p);
        var t = getOrCreateTarget(p.pc, p.port);
        t.lastMode = p.mode;

        if (dir === "ui") {
            t.lastUiSendMs = nowMs();
            if (p.msg === 1 && p.data) {
                t.run.startedAtMs = t.lastUiSendMs;
                t.run.command = p.data;
                t.run.hasPass = false;
                t.run.hasFail = false;
                t.run.hasError = false;
                setJobState(t, "STARTING");
                t.lastMessage = p.data;
                schedulePersist();
            }
            return;
        }

        // board -> ui
        t.lastSeenMs = nowMs();
        ensurePresent(t);
        tryFlushPendingForTarget(p.pc, p.port);

        var data = (p.data || "").trim();

        if (p.msg === 3 && data) { // SW version
            setBoardVersion(p.pc, data);
            if (t.jobState === "UNKNOWN") setJobState(t, "IDLE");
            return;
        }

        if (p.msg === 8) { // TEST
            setJobState(t, "RUNNING");
            schedulePersist();
            return;
        }

        if (p.msg >= 10 && p.msg <= 13) { // TEXT
            if (looksLikeBoardModelName(data)) {
                setBoardModel(p.pc, data);
                if (t.jobState === "UNKNOWN") setJobState(t, "IDLE");
                return;
            }
            if (data) t.lastMessage = data;
            if (data.toUpperCase().indexOf("SCRIPT NOT EXIST") >= 0) {
                t.run.hasFail = true;
                setJobState(t, "BLOCKED");
            }
            schedulePersist();
            return;
        }

        if (p.msg === 6) { // PASS
            t.run.hasPass = true;
            setJobState(t, "READY");
            schedulePersist();
            return;
        }

        if (p.msg === 7) { // FAIL
            t.run.hasFail = true;
            setJobState(t, "FAIL");
            schedulePersist();
            return;
        }

        if (p.msg === 71) { // ERROR
            t.run.hasError = true;
            setJobState(t, "FAIL");
            schedulePersist();
            return;
        }

        if (p.msg === 61) { // SCRIPT_END
            if (t.run.hasPass) setJobState(t, "READY");
            else if (t.run.hasFail || t.run.hasError) setJobState(t, "FAIL");
            else setJobState(t, "MANUALFAIL");
            schedulePersist();
            return;
        }

        if (data) t.lastMessage = data;
        if (t.jobState === "UNKNOWN") setJobState(t, "IDLE");
        schedulePersist();
    }

    // ---- derived status ----
    function connectivityBadge(t) {
        if (!t.lastSeenMs) return { text: "UNKNOWN" };
        var age = nowMs() - t.lastSeenMs;
        if (age > STALE_OFFLINE_MS) return { text: "OFFLINE" };
        if (age > STALE_WARN_MS) return { text: "STALE" };
        return { text: "ONLINE" };
    }

    function getDisplayState(t) {
        // 대표 상태(우선순위)
        var conn = connectivityBadge(t).text;
        if (conn === "OFFLINE") return "Disconnected/Offline";
        if (conn === "STALE") return "Stale";

        var job = (t.jobState || "UNKNOWN");
        if (job === "FAIL" || job === "MANUALFAIL" || job === "BLOCKED") return job;
        if (job === "RUNNING") return "Running";
        if (job === "STARTING" || job === "QUEUED") return job;
        if (job === "IDLE" || job === "READY") return "Idle/Ready";

        var prov = (t.provState || "UNKNOWN");
        if (prov === "UNKNOWN") return "Unknown";
        if (prov === "EMPTY") return "Empty";
        return "Unknown";
    }

    function deviceNoFor(pc, port) {
        var ppb = Math.max(1, sysCfg.portsPerBoard || 1);
        return (pc * ppb) - (ppb - port);
    }

    function portVisual(t) {
        // 이미지 스타일 라벨/색상으로 매핑
        if (!t) return { label: "Empty", cls: "st-empty" };

        if (t.provState === "EMPTY") return { label: "Empty", cls: "st-empty" };

        var conn = connectivityBadge(t).text;
        if (conn === "OFFLINE") return { label: "Disconnected", cls: "st-disconnected" };
        if (conn === "STALE") return { label: "Disconnected", cls: "st-stale" };

        switch (t.jobState) {
            case "RUNNING": return { label: "Running", cls: "st-running" };
            case "STARTING":
            case "QUEUED": return { label: "Running", cls: "st-running" };
            case "FAIL": return { label: "Fail", cls: "st-fail" };
            case "MANUALFAIL": return { label: "ManualFail", cls: "st-manual" };
            case "BLOCKED": return { label: "Blocked", cls: "st-blocked" };
            case "IDLE": return { label: "Idle", cls: "st-idle" };
            case "READY": return { label: "Ready", cls: "st-ready" };
            default:
                // 아직 아무 데이터가 없으면 Empty로 보이게(이미지 UX)
                if (t.provState === "UNKNOWN") return { label: "Empty", cls: "st-empty" };
                return { label: "Ready", cls: "st-ready" };
        }
    }

    // Filters UI 제거됨 → 항상 통과
    function passesFilters(t) {
        return true;
    }

    function renderSelected() {
        var tbody = $("selTableBody");
        if ($("selCount")) $("selCount").textContent = String(getSelectedKeys().size);
        if (!tbody) return;
        if (getSelectedKeys().size === 0) {
            tbody.innerHTML = "<tr><td colspan=\"5\" class=\"text-muted text-center\">No selected items</td></tr>";
            return;
        }
        var keysList = Array.from(getSelectedKeys());
        var rows = [];
        for (var i = 0; i < keysList.length; i++) {
            var key = keysList[i];
            var t = targets.get(key);
            var status = "-";
            var model = "-";
            var ver = "-";
            var msg = "-";
            if (t) {
                var base = getDisplayState(t);
                var conn = connectivityBadge(t).text;
                status = base + " / " + conn;
                model = t.modelName || "-";
                ver = t.version || "-";
                msg = t.lastMessage || "-";
            }
            rows.push("<tr><td>" + escapeHtml(key) + "</td><td>" + escapeHtml(status) + "</td><td>" + escapeHtml(model) + "</td><td>" + escapeHtml(ver) + "</td><td>" + escapeHtml(msg) + "</td></tr>");
        }
        tbody.innerHTML = rows.join("");
        syncTestLastSelectionInputs();
    }
    function escapeHtml(s) {
        if (s == null || s === "") return "";
        var str = String(s);
        return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    }

    function renderAll() {
        if (window.BoardPortStatus) BoardPortStatus.update();
        renderSelected();
    }

    // ---- ws handlers ----
    function handleWsMessage(raw) {
        var rawText = (raw && raw.data != null) ? String(raw.data) : String(raw);
        var bodies = drainFramesFromRemainder(rawText);
        var parsedAny = false;
        for (var i = 0; i < bodies.length; i++) {
            var body = bodies[i];
            var parsed = parseFrame(body);
            if (!parsed) continue;
            parsedAny = true;

            // heartbeat: "<0,pc,0,0,0,0,>" (로그 출력 X)
            if (parsed.mode === 0 && parsed.msg === 0) {
                markBoardAlive(parsed.pc);
                continue;
            }

            updateFromParsedWithFanOut(parsed, rawText);
            appendLog("[" + fmtTime(nowMs()) + "] " + (directionOf(parsed).toUpperCase()) + " <" + body + ">");
        }
        if (!parsedAny) return;
    }

    function connect() {
        if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
        ws = new WebSocket(getWsUrl());
        ws.onopen = function () {
            appendLog("[" + fmtTime(nowMs()) + "] [client] connected");
        };
        ws.onmessage = function (e) {
            handleWsMessage(e);
            renderAll();
        };
        ws.onclose = function () {
            appendLog("[" + fmtTime(nowMs()) + "] [client] disconnected");
        };
        ws.onerror = function () {
            appendLog("[" + fmtTime(nowMs()) + "] [client] error (url=" + getWsUrl() + ")");
        };
    }

    function disconnect() {
        if (!ws) return;
        try { ws.close(); } catch (e) { }
        ws = null;
    }

    function tryFlushPendingForTarget(pc, port) {
        var key = keyOf(pc, port);
        var pending = pendingSendQueue.get(key);
        if (!pending) return;
        var t = targets.get(key);
        if (!t || connectivityBadge(t).text !== "ONLINE") return;
        pendingSendQueue.delete(key);
        sendWsText(pending.msg);
        appendLog("[" + fmtTime(nowMs()) + "] [send] 재연결 후 대기 큐 전송: " + key);
    }

    function sendWsText(text) {
        var msg = String(text || "");
        if (!msg) return;
        if (ws && ws.readyState === WebSocket.OPEN) {
            try {
                ws.send(msg);
                appendLog("[" + fmtTime(nowMs()) + "] [UI SEND] " + msg);
                return;
            } catch (e) {
                appendLog("[" + fmtTime(nowMs()) + "] [UI SEND] failed: " + (e && e.message ? e.message : String(e)));
                return;
            }
        }

        // 연결이 없으면 먼저 연결 후 전송(1회)
        appendLog("[" + fmtTime(nowMs()) + "] [UI SEND] ws not open -> connect then send");
        var pending = msg;
        connect();
        // onopen 이후 한번만 보내기 위해 간단 폴링(최대 1초)
        var start = nowMs();
        var timer = setInterval(function () {
            if (ws && ws.readyState === WebSocket.OPEN) {
                clearInterval(timer);
                try {
                    ws.send(pending);
                    appendLog("[" + fmtTime(nowMs()) + "] [UI SEND] " + pending);
                } catch (e2) {
                    appendLog("[" + fmtTime(nowMs()) + "] [UI SEND] failed: " + (e2 && e2.message ? e2.message : String(e2)));
                }
                return;
            }
            if (nowMs() - start > 1000) {
                clearInterval(timer);
                appendLog("[" + fmtTime(nowMs()) + "] [UI SEND] timeout: ws not connected");
            }
        }, 50);
    }

    // ---- config preload ----
    function parseConfigTxt(txt) {
        var map = {};
        if (!txt) return map;
        var lines = String(txt).split(/\r?\n/);
        for (var i = 0; i < lines.length; i++) {
            var line = lines[i].trim();
            if (!line) continue;
            if (line.startsWith("#") || line.startsWith("//")) continue;
            var sepIdx = line.indexOf("=");
            if (sepIdx < 0) sepIdx = line.indexOf(":");
            if (sepIdx < 0) continue;
            var k = line.substring(0, sepIdx).trim();
            var v = line.substring(sepIdx + 1).trim();
            if (k) map[k] = v;
        }
        return map;
    }

    function toInt(map, key, fallback) {
        if (!map || map[key] == null) return fallback;
        var n = parseInt(String(map[key]).trim(), 10);
        return Number.isFinite(n) ? n : fallback;
    }

    function preloadTargetsFromConfig(map) {
        var startChamber = toInt(map, "StartChamberNumber", 1);
        var maxChamber = toInt(map, "MaxChamberCount", 1);
        var boardRows = toInt(map, "BoardRowCount", 1);
        var boardCols = toInt(map, "BoardColumnCount", 1);
        var portRows = toInt(map, "InBoardDutRowCount", 1);
        var portCols = toInt(map, "InBoardDutColumnCount", 1);

        sysCfg.startChamber = startChamber;
        sysCfg.maxChamber = maxChamber;
        sysCfg.boardRows = Math.max(1, boardRows);
        sysCfg.boardCols = Math.max(1, boardCols);
        sysCfg.portRows = Math.max(1, portRows);
        sysCfg.portCols = Math.max(1, portCols);
        sysCfg.boardsPerChamber = Math.max(1, sysCfg.boardRows * sysCfg.boardCols);
        sysCfg.portsPerBoard = Math.max(1, sysCfg.portRows * sysCfg.portCols);
        if (!sysCfg.isDuts) sysCfg.portsPerBoard = 1;

        // 기본 챔버는 startChamber
        selectedChamber = startChamber;

        if (window.BoardPortStatus) BoardPortStatus.buildChamberButtons();

        // 프리로드: 모든 챔버의 보드/포트를 생성 (isDuts면 포트1,2 / 아니면 포트0)
        var plist = portListForBoard();
        for (var chamber = startChamber; chamber < startChamber + maxChamber; chamber++) {
            var range = boardRangeForChamber(chamber);
            for (var pc = range.startPc; pc <= range.endPc; pc++) {
                for (var pi = 0; pi < plist.length; pi++) {
                    getOrCreateTarget(pc, plist[pi]);
                }
            }
        }

        // state 복원(모델/버전/lastSeen 등)
        restoreState();

        // 복원된 챔버가 config 범위 밖이면 보정
        var list = chamberList();
        if (list.length && list.indexOf(selectedChamber) < 0) selectedChamber = list[0];
        if (window.BoardPortStatus) {
            BoardPortStatus.buildChamberButtons();
            BoardPortStatus.setChamberButtonsActive($("dashChamberButtons"));
            BoardPortStatus.ensureBuilt(true);
        }
        appendLog("[" + fmtTime(nowMs()) + "] [config] loaded: startCh=" + startChamber
            + " maxCh=" + maxChamber
            + " boards=" + sysCfg.boardsPerChamber
            + " ports=" + sysCfg.portsPerBoard);
        renderAll();
    }

    function tryLoadConfigAndPreload() {
        var url = "/assets/config/Config.txt";
        fetch(url, { cache: "no-store" })
            .then(function (res) {
                if (!res.ok) throw new Error("HTTP " + res.status);
                return res.text();
            })
            .then(function (txt) {
                preloadTargetsFromConfig(parseConfigTxt(txt));
            })
            .catch(function (err) {
                appendLog("[" + fmtTime(nowMs()) + "] [config] not loaded (" + url + "): " + (err && err.message ? err.message : String(err)));
                // config 없이도 최소 동작은 가능
                if (window.BoardPortStatus) BoardPortStatus.ensureBuilt(true);
                renderAll();
            });
    }

    function buildSendMessageByTag(tag, pc, port, optData) {
        var portPadded = String(port).padStart(2, "0");
        var basePath = "share/tester/" + pc + "/" + portPadded + "/";
        switch (String(tag || "").toUpperCase()) {
            case "SIMPLETEST":
                return "<6," + pc + "," + port + ",1,0,0," + basePath + "Aging1.c>";
            case "SYSCMD":
                return "<6," + pc + "," + port + ",1,0,0," + "exec/exsyscmd.c " + (optData != null ? String(optData) : "") + ">";
            case "POWER":
                return "<6," + pc + "," + port + ",1,0,0," + basePath + "Reboot.c>";
            case "NETWORK":
                return "<6," + pc + "," + port + ",1,0,0," + basePath + "Speed.c>";
            case "EXCHECK":
                return "<6," + pc + "," + port + ",1,0,0," + "exec/exexcheck.c " + String(port) + ">";
            default:
                return "<6," + pc + "," + port + ",1,0,0," + basePath + "Aging1.c>";
        }
    }

    // Dashboard Tabs (Selected / Log Message)
    function initDashboardTabs() {
        var container = document.querySelector(".dashboard-tabs-container");
        if (!container) return;

        var STORAGE_KEY = "dashboard.tabs.state";
        var tabs = Array.from(container.querySelectorAll(".dashboard-tab-btn"));
        var contents = Array.from(container.querySelectorAll(".dashboard-tab-content"));

        function getTabState() {
            try {
                var saved = localStorage.getItem(STORAGE_KEY);
                if (saved) {
                    var parsed = JSON.parse(saved);
                    if (parsed && typeof parsed === "object") return parsed;
                }
            } catch (e) { }
            return { active: "selected", hidden: [] };
        }

        function saveTabState(state) {
            try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) { }
        }

        function switchTab(tabId) {
            if (!tabId) return;
            tabs.forEach(function (btn) {
                var id = btn.getAttribute("data-tab");
                var isActive = id === tabId;
                btn.classList.toggle("active", isActive);
                btn.setAttribute("aria-selected", isActive ? "true" : "false");
            });
            contents.forEach(function (content) {
                var id = content.id.replace("dashboard-tab-", "");
                content.classList.toggle("active", id === tabId);
            });
            var state = getTabState();
            state.active = tabId;
            saveTabState(state);
        }

        function renderHiddenTabs() {
            var header = container.querySelector(".dashboard-tabs-header");
            if (!header) return;

            var existingRestore = header.querySelector(".dashboard-tabs-restore");
            if (existingRestore) existingRestore.remove();

            var state = getTabState();
            var hiddenTabs = state.hidden || [];
            if (hiddenTabs.length === 0) return;

            var restoreContainer = document.createElement("div");
            restoreContainer.className = "dashboard-tabs-restore";
            restoreContainer.style.cssText = "display: flex; gap: 0.25rem; margin-left: auto; align-items: center;";

            hiddenTabs.forEach(function (tabId) {
                var tabInfo = { selected: "Selected", log: "Log Message" };
                var label = tabInfo[tabId] || tabId;
                var restoreBtn = document.createElement("button");
                restoreBtn.type = "button";
                restoreBtn.className = "dashboard-tab-restore-btn";
                restoreBtn.textContent = label;
                restoreBtn.title = "Click to restore " + label;
                restoreBtn.style.cssText = "padding: 0.25rem 0.5rem; font-size: 0.75rem; background: var(--bg-2); border: 1px solid var(--app-border); border-radius: 0.25rem; color: var(--app-text); cursor: pointer; opacity: 0.7;";
                restoreBtn.addEventListener("click", function () {
                    toggleTabVisibility(tabId, false);
                    renderHiddenTabs();
                });
                restoreContainer.appendChild(restoreBtn);
            });

            header.appendChild(restoreContainer);
        }

        function toggleTabVisibility(tabId, hide) {
            var btn = tabs.find(function (b) { return b.getAttribute("data-tab") === tabId; });
            var content = contents.find(function (c) { return c.id === "dashboard-tab-" + tabId; });
            if (!btn || !content) return;

            if (hide) {
                btn.classList.add("hidden");
                content.classList.add("hidden");
                if (btn.classList.contains("active")) {
                    var visibleTabs = tabs.filter(function (b) {
                        return !b.classList.contains("hidden") && b.getAttribute("data-tab") !== tabId;
                    });
                    if (visibleTabs.length > 0) switchTab(visibleTabs[0].getAttribute("data-tab"));
                }
            } else {
                btn.classList.remove("hidden");
                content.classList.remove("hidden");
                switchTab(tabId);
            }

            var state = getTabState();
            if (hide) {
                if (state.hidden.indexOf(tabId) < 0) state.hidden.push(tabId);
            } else {
                state.hidden = state.hidden.filter(function (id) { return id !== tabId; });
            }
            saveTabState(state);
            renderHiddenTabs();
        }

        function restoreTabState() {
            var state = getTabState();
            state.hidden.forEach(function (tabId) {
                var btn = tabs.find(function (b) { return b.getAttribute("data-tab") === tabId; });
                var content = contents.find(function (c) { return c.id === "dashboard-tab-" + tabId; });
                if (btn) btn.classList.add("hidden");
                if (content) content.classList.add("hidden");
            });
            if (state.active && tabs.find(function (b) { return b.getAttribute("data-tab") === state.active && !b.classList.contains("hidden"); })) {
                switchTab(state.active);
            }
            renderHiddenTabs();
        }

        tabs.forEach(function (btn) {
            var tabId = btn.getAttribute("data-tab");
            btn.addEventListener("click", function (e) {
                if (e.target.classList.contains("dashboard-tab-close")) return;
                switchTab(tabId);
            });

            var closeBtn = btn.querySelector(".dashboard-tab-close");
            if (closeBtn) {
                closeBtn.addEventListener("click", function (e) {
                    e.stopPropagation();
                    toggleTabVisibility(tabId, true);
                });
            }
        });

        document.addEventListener("keydown", function (e) {
            if (e.key !== "Tab" || e.ctrlKey || e.altKey || e.metaKey || e.shiftKey) return;
            var activeInput = document.activeElement && (document.activeElement.tagName === "INPUT" || document.activeElement.tagName === "TEXTAREA");
            if (activeInput) return;

            e.preventDefault();
            var visibleTabs = tabs.filter(function (b) { return !b.classList.contains("hidden"); });
            if (visibleTabs.length < 2) return;

            var currentActive = visibleTabs.findIndex(function (b) { return b.classList.contains("active"); });
            var nextIndex = (currentActive + 1) % visibleTabs.length;
            switchTab(visibleTabs[nextIndex].getAttribute("data-tab"));
        });

        restoreTabState();
    }

    // UPDATE 섹션 우측: UPDATE/VERSION 서브탭 (UI 전환만)
    function applyUpdateSubTab(host, tab) {
        if (!host) return;
        tab = (tab || "update").toLowerCase();
        var btns = host.querySelectorAll("[data-update-tab]");
        var panels = host.querySelectorAll("[data-update-panel]");
        btns.forEach(function (b) {
            var t = (b.getAttribute("data-update-tab") || "").toLowerCase();
            var isActive = (t === tab);
            b.classList.toggle("active", isActive);
            b.setAttribute("aria-selected", isActive ? "true" : "false");
        });
        panels.forEach(function (p) {
            var pt = (p.getAttribute("data-update-panel") || "").toLowerCase();
            p.classList.toggle("d-none", pt !== tab);
        });
    }

    function initUpdateSubTabs() {
        var host = $("dashRightSectionHost");
        if (!host) return;
        var activeBtn = host.querySelector("[data-update-tab].active");
        var tab = activeBtn ? activeBtn.getAttribute("data-update-tab") : "update";
        applyUpdateSubTab(host, tab);
    }

    // UPDATE 섹션: 체크박스 체크 시에만 하위 컨트롤 활성화
    function applyUpdateCheckboxState(scope, checkbox) {
        if (!scope || !checkbox) return;
        var enabled = !!checkbox.checked;
        var nodes = scope.querySelectorAll("button, input, select, textarea");
        nodes.forEach(function (el) {
            if (el === checkbox) return;
            // 탭 버튼은 영향을 받지 않게
            if (el.hasAttribute && el.hasAttribute("data-update-tab")) return;
            el.disabled = !enabled;
        });
    }

    function initUpdateCheckboxEnables() {
        var host = $("dashRightSectionHost");
        if (!host) return;
        var updatePanel = host.querySelector("[data-update-panel='update']");
        if (!updatePanel) return;

        var boxes = updatePanel.querySelectorAll("input.form-check-input[type='checkbox']");
        boxes.forEach(function (cb) {
            var block = cb.closest ? cb.closest(".panel-block") : null;
            if (!block) return;
            applyUpdateCheckboxState(block, cb);
        });
    }

    function bindUi() {
        // Dashboard Tabs 초기화
        initDashboardTabs();
        initUpdateSubTabs();
        initUpdateCheckboxEnables();

        // Chamber 탭 / 그리드 포트 클릭은 BoardPortStatus 모듈에서 바인딩
        document.addEventListener("click", function (e) {
            var btn = e.target && e.target.closest ? e.target.closest(".send-message-btn") : null;
            if (!btn) return;
            var tag = btn.getAttribute("data-tag") || "SIMPLETEST";
            var tagUpper = String(tag).toUpperCase();
            var sendData = null;
            if (tagUpper === "SYSCMD") {
                var syscmdEl = document.getElementById("syscmdData") || document.querySelector('input[data-send-for="SYSCMD"]');
                sendData = syscmdEl ? (syscmdEl.value || "").trim() : "";
                if (!sendData) {
                    appendLog("[" + fmtTime(nowMs()) + "] [send][SYSCMD] 입력 텍스트가 없습니다.");
                    return;
                }
            }
            var keysList = Array.from(getSelectedKeys());
            if (keysList.length === 0) {
                appendLog("[" + fmtTime(nowMs()) + "] [send] 선택된 포트가 없습니다.");
                return;
            }
            var pcToPort = {};
            var queuedCount = 0;
            keysList.forEach(function (k) {
                var key = String(k);
                var parts = key.split(":");
                var pc = parseInt(parts[0], 10);
                var port = parseInt(parts[1], 10);
                if (!Number.isFinite(pc) || !Number.isFinite(port) || port < 0) return;
                var t = targets.get(key);
                if (!t || portVisual(t).cls === "st-empty") return;
                var msg = buildSendMessageByTag(tag, pc, port, sendData);
                if (connectivityBadge(t).text === "ONLINE") {
                    if (pcToPort[pc] === undefined) pcToPort[pc] = port;
                } else {
                    pendingSendQueue.set(key, { msg: msg });
                    queuedCount++;
                }
            });
            var pcs = Object.keys(pcToPort);
            pcs.forEach(function (pcStr) {
                var pc = parseInt(pcStr, 10);
                var port = pcToPort[pc];
                var msg = buildSendMessageByTag(tag, pc, port, sendData);
                sendWsText(msg);
            });
            if (pcs.length > 0 || queuedCount > 0) {
                var logParts = [];
                if (pcs.length > 0) logParts.push(pcs.length + "개 즉시 전송");
                if (queuedCount > 0) logParts.push(queuedCount + "개 대기 큐 적재");
                appendLog("[" + fmtTime(nowMs()) + "] [send][" + tag + "] " + logParts.join(", ") + ".");
            } else {
                appendLog("[" + fmtTime(nowMs()) + "] [send][" + tag + "] 전송 가능한 포트가 없습니다. (Empty 제외)");
            }
        });

        // UPDATE/VERSION 서브탭 클릭(UPDATE 섹션)
        document.addEventListener("click", function (e) {
            var tabBtn = e.target && e.target.closest ? e.target.closest("[data-update-tab]") : null;
            if (!tabBtn) return;
            var host = tabBtn.closest ? tabBtn.closest("#dashRightSectionHost") : $("dashRightSectionHost");
            if (!host) return;
            var tab = tabBtn.getAttribute("data-update-tab") || "update";
            applyUpdateSubTab(host, tab);
            initUpdateCheckboxEnables();
        });

        // UPDATE 체크박스 변경 시 하위 컨트롤 토글
        document.addEventListener("change", function (e) {
            var cb = e.target;
            if (!cb || !cb.matches) return;
            if (!cb.matches("#dashRightSectionHost [data-update-panel='update'] input.form-check-input[type='checkbox']")) return;
            var block = cb.closest ? cb.closest(".panel-block") : null;
            if (!block) return;
            applyUpdateCheckboxState(block, cb);
        });
    }

    function startTicker() {
        setInterval(function () {
            renderAll();
        }, 500);
    }

    function getBoardPortStatusOptions() {
        return {
            gridId: "dashBoardGrid",
            chamberButtonsId: "dashChamberButtons",
            api: {
                getConfig: function () { return sysCfg; },
                getSelectedChamber: function () { return selectedChamber; },
                getSelectedKeys: function () { return getSelectedKeys(); },
                getSelectionMode: getSelectionMode,
                getTarget: getOrCreateTarget,
                keyOf: keyOf,
                deviceNoFor: deviceNoFor,
                fmtTime: fmtTime,
                passesFilters: passesFilters,
                connectivityBadge: connectivityBadge,
                getDisplayState: getDisplayState,
                portVisual: portVisual
            },
            onChamberSelect: function (ch) { selectChamber(ch, true); },
            onPortSelect: function (key) {
                var sel = getSelectedKeys();
                key = String(key);
                if (sel.has(key)) {
                    sel.delete(key);
                    // 선택 해제된 항목이 마지막 활성화 항목이면, 남은 선택 중 마지막으로 보정
                    if (lastSelectedKey === key) lastSelectedKey = lastOfSet(sel);
                } else {
                    sel.add(key);
                    // "활성화(ON)" 된 항목을 최근으로 기록
                    lastSelectedKey = key;
                }
                schedulePersist();
                renderAll();
            },
            onPortSelectRange: function (keys) {
                var sel = getSelectedKeys();
                var lastActivated = null;
                keys.forEach(function (k) {
                    k = String(k);
                    if (sel.has(k)) sel.delete(k);
                    else { sel.add(k); lastActivated = k; }
                });
                // 범위 선택 중 "활성화(ON)" 된 항목이 있으면 그중 마지막을 최근으로
                if (lastActivated) lastSelectedKey = lastActivated;
                else if (lastSelectedKey && !sel.has(lastSelectedKey)) lastSelectedKey = lastOfSet(sel);
                schedulePersist();
                renderAll();
            },
            onSelectPortsOnly: function (keys) {
                var sel = getSelectedKeys();
                sel.clear();
                var last = null;
                keys.forEach(function (k) { last = String(k); sel.add(last); });
                lastSelectedKey = last;
                schedulePersist();
                renderAll();
            },
            onBoardToggleMany: function (pcs) {
                if (!pcs || !pcs.length) return;
                var uniq = new Set();
                pcs.forEach(function (pc) { if (pc !== null && pc !== undefined) uniq.add(String(pc)); });
                var plist = portListForBoard();
                var sel = getSelectedKeys();
                var lastActivated = null;
                uniq.forEach(function (pcStr) {
                    var pc = parseInt(pcStr, 10);
                    if (!Number.isFinite(pc)) return;
                    var anySel = false;
                    for (var pi = 0; pi < plist.length; pi++) {
                        if (sel.has(keyOf(pc, plist[pi]))) { anySel = true; break; }
                    }
                    for (var pi2 = 0; pi2 < plist.length; pi2++) {
                        var k2 = keyOf(pc, plist[pi2]);
                        if (anySel) sel.delete(k2);
                        else { sel.add(k2); lastActivated = k2; }
                    }
                });
                if (lastActivated) lastSelectedKey = lastActivated;
                else if (lastSelectedKey && !sel.has(lastSelectedKey)) lastSelectedKey = lastOfSet(sel);
                schedulePersist();
                renderAll();
            },
            onClearSelection: function () {
                var sel = getSelectedKeys();
                if (sel.size === 0) return;
                sel.clear();
                lastSelectedKey = null;
                schedulePersist();
                renderAll();
            }
        };
    }

    function applySectionToGrid(section) {
        var gridEl = $("dashBoardGrid");
        if (!gridEl) return;
        var isDuts = (section !== "TPC" && section !== "DIAG" && section !== "UPDATE");
        gridEl.setAttribute("data-is-duts", isDuts ? "true" : "false");
        sysCfg.isDuts = isDuts;
    }

    function reinitGridOnly() {
        applySectionToGrid(getSection());
        if (window.BoardPortStatus) BoardPortStatus.init(getBoardPortStatusOptions());
        if (window.BoardPortStatus) BoardPortStatus.buildChamberButtons();
        if (window.BoardPortStatus) BoardPortStatus.ensureBuilt(true);
        initDashboardTabs();
        initUpdateSubTabs();
        initUpdateCheckboxEnables();
        syncLogToDom();
        renderAll();
        try {
            if (window.ResizeObserver && window.BoardPortStatus) {
                var wrap = $("dashBoardGrid") ? $("dashBoardGrid").parentElement : null;
                if (wrap) {
                    var ro = new ResizeObserver(function () { BoardPortStatus.requestGridFit(); });
                    ro.observe(wrap);
                }
            }
        } catch (e) { }
    }

    var dashboardSectionLoaded = false;

    // Section navigation is canonicalized by the server.
    // Do not AJAX-replace main content; always navigate to the canonical URL.
    function loadDashboardSection(section) {
        if (!section) return;
        var url = "/Dashboard?section=" + encodeURIComponent(section);
        window.location.href = url;
    }

    document.addEventListener("DOMContentLoaded", function () {
        if (!$("dashBoardGrid")) return;

        var gridEl = $("dashBoardGrid");
        var isDutsVal = (gridEl && gridEl.getAttribute && gridEl.getAttribute("data-is-duts"));
        if (isDutsVal === null || isDutsVal === undefined) isDutsVal = (window.dashboard && window.dashboard.section && (window.dashboard.section === "TPC" || window.dashboard.section === "DIAG" || window.dashboard.section === "UPDATE") ? "false" : "true");
        if (isDutsVal === "true" || isDutsVal === true) sysCfg.isDuts = true;
        else if (isDutsVal === "false" || isDutsVal === false) sysCfg.isDuts = false;

        if (window.BoardPortStatus) BoardPortStatus.init(getBoardPortStatusOptions());

        bindUi();
        bindChamberHotkeys();
        if (window.BoardPortStatus) BoardPortStatus.buildChamberButtons();
        if (window.BoardPortStatus) BoardPortStatus.ensureBuilt(true);
        startTicker();
        tryLoadConfigAndPreload();
        connect();
        syncLogToDom();
        dashboardSectionLoaded = true;

        document.addEventListener("click", function (e) {
            var a = e.target && e.target.closest ? e.target.closest("a[href*='/Dashboard'][href*='section=']") : null;
            if (!a || a.getAttribute("href").indexOf("/Dashboard") < 0) return;
            var path = (location.pathname || "").toLowerCase().replace(/\/$/, "") || "/";
            if (path !== "/dashboard") return;
            var href = a.getAttribute("href") || "";
            var match = href.match(/section=([^&]+)/);
            var section = match ? decodeURIComponent(match[1]).trim().toUpperCase() : "";
            if (section !== "TEST" && section !== "TPC" && section !== "DPS" && section !== "DIAG" && section !== "UPDATE") section = "TEST";
            if (section === getSection()) return;
            e.preventDefault();
            loadDashboardSection(section);
        });

        // no pushState-based section navigation

        window.addEventListener("resize", function () {
            if (window.BoardPortStatus) BoardPortStatus.requestGridFit();
        });

        try {
            if (window.ResizeObserver && window.BoardPortStatus) {
                var wrap = $("dashBoardGrid") ? $("dashBoardGrid").parentElement : null;
                if (wrap) {
                    var ro = new ResizeObserver(function () { BoardPortStatus.requestGridFit(); });
                    ro.observe(wrap);
                }
            }
        } catch (e) { }
    });
})();

