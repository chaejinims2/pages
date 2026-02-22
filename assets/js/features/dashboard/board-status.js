/**
 * Board / Port Status 모듈 (WPF UserControl에 해당)
 * - Chamber 탭, 보드 그리드 빌드/스케일, 포트 라인 갱신만 담당.
 * - 상태( targets, selectedChamber 등 )는 외부(dashboard)에서 api로 주입.
 */
(function (global) {
    "use strict";

    function el(idOrEl) {
        if (typeof idOrEl === "string") return document.getElementById(idOrEl);
        return idOrEl;
    }

    var api = null;
    var opts = null;

    // 그리드 전용 캐시
    var portElByKey = new Map();
    var portSigByKey = new Map();
    var tileByPc = new Map();  // pc -> tile element (선택 시 타일 전체 강조용)
    var gridBuiltForChamber = 0;
    var dragStart = null;
    var selectionRectEl = null;
    var dragJustEnded = false;
    var DRAG_THRESHOLD_PX = 4;
    var gridBuiltSig = "";
    var gridFitSig = "";
    var gridFitRafPending = false;
    var gridScale = 1;

    function getCfg() { return api && api.getConfig ? api.getConfig() : {}; }
    /** isDuts면 [1..portsPerBoard], 아니면 [0] */
    function getPortList(cfg) {
        cfg = cfg || getCfg();
        if (cfg.isDuts) {
            var arr = [];
            for (var i = 1; i <= Math.max(1, cfg.portsPerBoard || 1); i++) arr.push(i);
            return arr;
        }
        return [0];
    }
    function getChamber() { return api && api.getSelectedChamber ? api.getSelectedChamber() : 1; }
    function getSelectedKeys() {
        var keys = api && api.getSelectedKeys ? api.getSelectedKeys() : null;
        return keys && typeof keys.has === "function" ? keys : new Set();
    }
    function getSelectionMode() {
        return api && api.getSelectionMode ? api.getSelectionMode() : "port";
    }

    function chamberList() {
        var cfg = getCfg();
        var start = Math.max(1, cfg.startChamber || 1);
        var count = Math.max(1, cfg.maxChamber || 1);
        var out = [];
        for (var ch = start; ch < start + count; ch++) out.push(ch);
        return out;
    }

    function boardRangeForChamber(chamberIndex) {
        var cfg = getCfg();
        var bpc = Math.max(1, cfg.boardsPerChamber || 1);
        var startPc = (bpc * (chamberIndex - 1)) + 1;
        return { startPc: startPc, endPc: startPc + bpc - 1 };
    }

    function setChamberButtonsActive(container) {
        if (!container || !api) return;
        var btns = container.querySelectorAll("button[data-chamber]");
        var sel = getChamber();
        btns.forEach(function (b) {
            var val = parseInt(String(b.getAttribute("data-chamber")), 10);
            var isActive = (val === sel);
            if (isActive) {
                b.classList.remove("btn-outline-light");
                b.classList.add("btn-light");
                b.setAttribute("aria-selected", "true");
                b.setAttribute("tabindex", "0");
            } else {
                b.classList.remove("btn-light");
                b.classList.add("btn-outline-light");
                b.setAttribute("aria-selected", "false");
                b.setAttribute("tabindex", "-1");
            }
        });
    }

    function requestGridFit() {
        if (gridFitRafPending) return;
        gridFitRafPending = true;
        requestAnimationFrame(function () {
            gridFitRafPending = false;
            applyGridScaleToFit(false);
        });
    }

    function applyGridScaleToFit(force) {
        var grid = el(opts.gridId);
        if (!grid) return;
        var wrap = grid.parentElement;
        if (!wrap) return;

        var cfg = getCfg();
        var boardCols = Math.max(1, cfg.boardCols || 1);
        var ch = getChamber();
        var curFitSig = [wrap.clientWidth, wrap.clientHeight, ch, boardCols].join("|");
        if (!force && curFitSig === gridFitSig) return;
        gridFitSig = curFitSig;

        grid.style.transform = "scale(1)";
        grid.style.gridTemplateColumns = "repeat(" + boardCols + ", minmax(0, 1fr))";
        gridScale = 1;
    }

    function ensureBoardGridBuilt(forceRebuild) {
        var grid = el(opts.gridId);
        if (!grid) return;

        var ch = parseInt(String(getChamber()), 10);
        var cfg = getCfg();
        if (!Number.isFinite(ch)) ch = Math.max(1, cfg.startChamber || 1);

        var ppb = Math.max(1, cfg.portsPerBoard || 1);
        var isDuts = cfg.isDuts !== false;
        var sig = [ch, cfg.boardRows, cfg.boardCols, ppb, isDuts ? "duts" : "noduts"].join("|");
        if (!forceRebuild && gridBuiltForChamber === ch && gridBuiltSig === sig) return;

        grid.textContent = "";
        portElByKey.clear();
        portSigByKey.clear();
        tileByPc.clear();
        gridBuiltForChamber = ch;
        gridBuiltSig = sig;

        var boardCols = Math.max(1, cfg.boardCols || 1);
        var boardRows = Math.max(1, cfg.boardRows || 1);
        grid.style.gridTemplateColumns = "repeat(" + boardCols + ", minmax(0, 1fr))";

        var range = boardRangeForChamber(ch);
        var bpc = Math.max(1, cfg.boardsPerChamber || 1);
        var keyOf = api.keyOf;
        var deviceNoFor = api.deviceNoFor;

        /* 열 우선 배치: 1열 1,2,3... 2열 11,12,13... 3열 21,22,23... */
        for (var r = 0; r < boardRows; r++) {
            for (var c = 0; c < boardCols; c++) {
                var idx = (c * boardRows) + r;
                if (idx >= bpc) continue;
                var pc = range.startPc + idx;

                var tile = document.createElement("div");
                tile.className = "board-tile east-tile";
                tile.setAttribute("data-pc", String(pc));

                var boardNo = document.createElement("div");
                boardNo.className = "east-board-no";
                boardNo.textContent = String(pc);

                var ports = document.createElement("div");
                ports.className = "east-ports";

                var portList = getPortList(cfg);
                for (var pi = 0; pi < portList.length; pi++) {
                    var port = portList[pi];
                    var key = keyOf(pc, port);
                    var line = document.createElement("div");
                    line.className = "east-port-line st-empty";
                    line.setAttribute("data-key", key);

                    var left = document.createElement("span");
                    left.className = "east-left";
                    var dot = document.createElement("span");
                    dot.className = "east-dot";
                    var label = document.createElement("span");
                    label.className = "east-label";
                    label.textContent = "Empty";
                    var hash = document.createElement("span");
                    hash.className = "east-hash";
                    hash.textContent = "#" + deviceNoFor(pc, port);

                    left.appendChild(dot);
                    left.appendChild(label);
                    line.appendChild(left);
                    line.appendChild(hash);
                    ports.appendChild(line);
                    portElByKey.set(key, line);
                    portSigByKey.set(key, "");
                }

                tile.appendChild(boardNo);
                tile.appendChild(ports);
                tileByPc.set(pc, tile);
                grid.appendChild(tile);
            }
        }

        requestGridFit();
    }

    function computePortSignature(t) {
        if (!api.portVisual || !api.passesFilters) return "";
        var v = api.portVisual(t);
        var dim = api.passesFilters(t) ? "0" : "1";
        var keys = getSelectedKeys();
        var sel = keys.has(t.key) ? "1" : "0";
        return [v.cls, v.label, dim, sel].join("|");
    }

    function applyPortCellIfChanged(t) {
        var line = portElByKey.get(t.key);
        if (!line) return;

        var sig = computePortSignature(t);
        var prev = portSigByKey.get(t.key);
        if (sig === prev) return;
        portSigByKey.set(t.key, sig);

        var v = api.portVisual(t);
        var isDim = api.passesFilters ? !api.passesFilters(t) : false;
        var keys = getSelectedKeys();
        var isSel = keys.has(t.key);

        line.className = "east-port-line " + v.cls + (isDim ? " dim" : "") + (isSel ? " sel" : "");

        var labelEl = line.querySelector(".east-label");
        if (labelEl && labelEl.textContent !== v.label) labelEl.textContent = v.label;

        var base = api.getDisplayState ? api.getDisplayState(t) : "";
        var conn = api.connectivityBadge ? api.connectivityBadge(t).text : "";
        var lastSeenText = t.lastSeenMs && api.fmtTime ? api.fmtTime(t.lastSeenMs) : "-";
        var extra = [];
        if (t.modelName) extra.push("Model=" + t.modelName);
        if (t.version) extra.push("SW=" + t.version);
        if (t.lastMessage) extra.push("Msg=" + t.lastMessage);
        line.title = t.key + "  [" + base + "/" + conn + "]  lastSeen=" + lastSeenText + (extra.length ? "\n" + extra.join("\n") : "");
    }

    function buildChamberButtons() {
        var container = el(opts.chamberButtonsId);
        if (!container) return;
        container.textContent = "";

        var list = chamberList();
        for (var i = 0; i < list.length; i++) {
            var btn = document.createElement("button");
            btn.type = "button";
            btn.className = "btn btn-sm btn-outline-light";
            btn.setAttribute("data-chamber", String(list[i]));
            btn.setAttribute("role", "tab");
            btn.setAttribute("aria-selected", "false");
            btn.setAttribute("tabindex", "-1");
            btn.textContent = "Cham" + list[i];
            container.appendChild(btn);
        }

        setChamberButtonsActive(container);
    }

    function render() {
        ensureBoardGridBuilt(false);
        var ch = parseInt(String(getChamber()), 10);
        var cfg = getCfg();
        if (!Number.isFinite(ch)) ch = Math.max(1, cfg.startChamber || 1);
        var range = boardRangeForChamber(ch);
        var portList = getPortList(cfg);
        var getTarget = api.getTarget;
        if (!getTarget) return;
        var keys = getSelectedKeys();
        var keyOf = api.keyOf;
        for (var pc = range.startPc; pc <= range.endPc; pc++) {
            var allEmpty = true;
            var anySelected = false;
            for (var pi = 0; pi < portList.length; pi++) {
                var port = portList[pi];
                var t = getTarget(pc, port);
                if (t) {
                    applyPortCellIfChanged(t);
                    if (api.portVisual && api.portVisual(t).cls !== "st-empty") allEmpty = false;
                    if (keyOf && keys.has(keyOf(pc, port))) anySelected = true;
                }
            }
            var tile = tileByPc.get(pc);
            if (tile) {
                if (anySelected) tile.classList.add("east-tile-selected");
                else tile.classList.remove("east-tile-selected");
                if (allEmpty) tile.classList.add("tile-all-empty");
                else tile.classList.remove("tile-all-empty");
            }
        }
    }

    function rectsOverlap(r1, r2) {
        return !(r1.right < r2.left || r1.left > r2.right || r1.bottom < r2.top || r1.top > r2.bottom);
    }

    function getPortKeysInRect(gridEl, left, top, width, height) {
        if (!gridEl || width <= 0 || height <= 0) return [];
        var sel = { left: left, top: top, right: left + width, bottom: top + height };
        var lines = gridEl.querySelectorAll(".east-port-line[data-key]");
        var keys = [];
        for (var i = 0; i < lines.length; i++) {
            var r = lines[i].getBoundingClientRect();
            if (rectsOverlap(sel, r)) keys.push(lines[i].getAttribute("data-key"));
        }
        return keys;
    }

    function getBoardPcsInRect(gridEl, left, top, width, height) {
        if (!gridEl || width <= 0 || height <= 0) return [];
        var sel = { left: left, top: top, right: left + width, bottom: top + height };
        var tiles = gridEl.querySelectorAll(".board-tile[data-pc]");
        var pcs = [];
        for (var i = 0; i < tiles.length; i++) {
            var r = tiles[i].getBoundingClientRect();
            if (rectsOverlap(sel, r)) pcs.push(tiles[i].getAttribute("data-pc"));
        }
        return pcs;
    }

    function startDrag(clientX, clientY) {
        if (selectionRectEl) return;
        selectionRectEl = document.createElement("div");
        selectionRectEl.className = "east-drag-selection";
        selectionRectEl.style.left = clientX + "px";
        selectionRectEl.style.top = clientY + "px";
        selectionRectEl.style.width = "0";
        selectionRectEl.style.height = "0";
        document.body.appendChild(selectionRectEl);
        dragStart = { x: clientX, y: clientY };
    }

    function updateDrag(clientX, clientY) {
        if (!dragStart || !selectionRectEl) return;
        var left = Math.min(dragStart.x, clientX);
        var top = Math.min(dragStart.y, clientY);
        var w = Math.abs(clientX - dragStart.x);
        var h = Math.abs(clientY - dragStart.y);
        selectionRectEl.style.left = left + "px";
        selectionRectEl.style.top = top + "px";
        selectionRectEl.style.width = w + "px";
        selectionRectEl.style.height = h + "px";
    }

    function endDrag(clientX, clientY) {
        if (!dragStart || !selectionRectEl) return;
        var left = Math.min(dragStart.x, clientX);
        var top = Math.min(dragStart.y, clientY);
        var w = Math.abs(clientX - dragStart.x);
        var h = Math.abs(clientY - dragStart.y);
        var grid = el(opts.gridId);
        var didRealDrag = (Math.abs(clientX - dragStart.x) >= DRAG_THRESHOLD_PX || Math.abs(clientY - dragStart.y) >= DRAG_THRESHOLD_PX);
        if (didRealDrag && grid && (w > 0 || h > 0)) {
            var mode = getSelectionMode();
            if (mode === "board" && typeof opts.onBoardToggleMany === "function") {
                var pcs = getBoardPcsInRect(grid, left, top, w, h);
                if (pcs.length) opts.onBoardToggleMany(pcs);
                dragJustEnded = true;
            } else if (mode !== "board" && typeof opts.onPortSelectRange === "function") {
                var keys = getPortKeysInRect(grid, left, top, w, h);
                if (keys.length) opts.onPortSelectRange(keys);
                dragJustEnded = true;
            }
        }
        if (selectionRectEl.parentNode) selectionRectEl.parentNode.removeChild(selectionRectEl);
        selectionRectEl = null;
        dragStart = null;
    }

    function onGridMouseDown(e) {
        if (e.button !== 0) return;
        var grid = el(opts.gridId);
        if (!grid || !e.target) return;

        // 드래그 시작 유효 영역: 데이터 그리드 영역(.board-grid-wrap)으로 제한
        var gridWrap = (grid.closest && grid.closest(".board-grid-wrap")) ? grid.closest(".board-grid-wrap") : (grid.parentElement && grid.parentElement.classList && grid.parentElement.classList.contains("board-grid-wrap") ? grid.parentElement : null);
        if (!gridWrap || !gridWrap.contains(e.target)) return;

        // 버튼/입력 위에서는 드래그 시작 안 함
        var interactive = e.target.closest ? e.target.closest("button,a,input,textarea,select,label") : null;
        if (interactive) return;

        e.preventDefault();
        startDrag(e.clientX, e.clientY);
        var moveHandler = function (e2) { updateDrag(e2.clientX, e2.clientY); };
        var upHandler = function (e2) {
            document.removeEventListener("mousemove", moveHandler);
            document.removeEventListener("mouseup", upHandler);
            endDrag(e2.clientX, e2.clientY);
        };
        document.addEventListener("mousemove", moveHandler);
        document.addEventListener("mouseup", upHandler);
    }

    function onPanelDoubleClick(e) {
        var grid = el(opts.gridId);
        if (!grid || !e || !e.target) return;
        if (typeof opts.onClearSelection !== "function") return;

        // 더블클릭 유효 영역: 데이터 그리드 영역(.board-grid-wrap)으로 제한
        var gridWrap = (grid.closest && grid.closest(".board-grid-wrap")) ? grid.closest(".board-grid-wrap") : (grid.parentElement && grid.parentElement.classList && grid.parentElement.classList.contains("board-grid-wrap") ? grid.parentElement : null);
        if (!gridWrap || !gridWrap.contains(e.target)) return;

        // 버튼/입력 등 인터랙티브 요소 더블클릭은 제외
        var interactive = e.target.closest ? e.target.closest("button,a,input,textarea,select,label") : null;
        if (interactive) return;

        // board-tile이 없는 영역(빈 배경)에서만 전체 선택 해제
        var tile = e.target.closest ? e.target.closest(".board-tile") : null;
        if (tile) return;

        e.preventDefault();
        opts.onClearSelection();
    }

    function bindEvents() {
        var chamberBox = el(opts.chamberButtonsId);
        if (chamberBox && opts.onChamberSelect) {
            chamberBox.addEventListener("click", function (e) {
                var btn = e.target && e.target.closest ? e.target.closest("button[data-chamber]") : null;
                if (!btn) return;
                var v = parseInt(String(btn.getAttribute("data-chamber")), 10);
                if (!Number.isFinite(v)) return;
                opts.onChamberSelect(v);
            });
        }

        var grid = el(opts.gridId);
        if (grid) {
            var gridWrap = (grid.closest && grid.closest(".board-grid-wrap")) ? grid.closest(".board-grid-wrap") : (grid.parentElement && grid.parentElement.classList && grid.parentElement.classList.contains("board-grid-wrap") ? grid.parentElement : null);
            if (!gridWrap) gridWrap = document.querySelector(".board-grid-wrap");
            if (gridWrap) {
                gridWrap.addEventListener("mousedown", onGridMouseDown);
                gridWrap.addEventListener("dblclick", onPanelDoubleClick);
            }
        }
        if (grid) {
            if (opts.onPortSelect || opts.onPortSelectRange || opts.onBoardToggleMany) {
                grid.addEventListener("click", function (e) {
                    if (dragJustEnded) {
                        dragJustEnded = false;
                        return;
                    }
                    var mode = getSelectionMode();

                    // 보드 단위 모드: 보드 번호/포트 클릭 모두 보드 전체 토글
                    var boardNo = e.target && e.target.closest ? e.target.closest(".east-board-no") : null;
                    if (boardNo && mode === "board" && typeof opts.onBoardToggleMany === "function") {
                        var tile = boardNo.closest ? boardNo.closest(".board-tile[data-pc]") : null;
                        if (tile) {
                            var pc = parseInt(String(tile.getAttribute("data-pc")), 10);
                            if (Number.isFinite(pc)) {
                                e.preventDefault();
                                opts.onBoardToggleMany([pc]);
                                return;
                            }
                        }
                    }
                    // 포트 단위 모드: 보드 번호 클릭 → 해당 보드의 포트 2개(1번, 2번)만 선택(기존 선택 교체)
                    if (boardNo && mode !== "board" && opts.onSelectPortsOnly && api && api.keyOf) {
                        var tile2 = boardNo.closest ? boardNo.closest(".board-tile[data-pc]") : null;
                        if (tile2) {
                            var pc2 = parseInt(String(tile2.getAttribute("data-pc")), 10);
                            if (Number.isFinite(pc2)) {
                                var keys2 = [api.keyOf(pc2, 1), api.keyOf(pc2, 2)];
                                e.preventDefault();
                                opts.onSelectPortsOnly(keys2);
                                return;
                            }
                        }
                    }
                    var line = e.target && e.target.closest ? e.target.closest(".east-port-line[data-key]") : null;
                    if (!line) return;
                    var key = line.getAttribute("data-key");
                    if (!key) return;
                    if (mode === "board" && typeof opts.onBoardToggleMany === "function") {
                        var tile3 = line.closest ? line.closest(".board-tile[data-pc]") : null;
                        if (tile3) {
                            var pc3 = parseInt(String(tile3.getAttribute("data-pc")), 10);
                            if (Number.isFinite(pc3)) {
                                e.preventDefault();
                                opts.onBoardToggleMany([pc3]);
                                return;
                            }
                        }
                    }
                    if (mode !== "board" && opts.onPortSelect) opts.onPortSelect(key);
                });
            }
        }
    }

    /**
     * @param {{
     *   gridId: string,
     *   chamberButtonsId: string,
     *   api: {
     *     getConfig: function,
     *     getSelectedChamber: function,
     *     getSelectedKeys: function (returns Set),
     *     getTarget: function(pc, port),
     *     keyOf: function(pc, port),
     *     deviceNoFor: function(pc, port),
     *     fmtTime: function(ms),
     *     passesFilters: function(t),
     *     connectivityBadge: function(t),
     *     getDisplayState: function(t),
     *     portVisual: function(t)
     *   },
     *   onChamberSelect: function(ch),
     *   onPortSelect: function(key),
     *   onPortSelectRange: function(keys)  // 드래그 사각형으로 여러 포트 선택 시(토글)
     *   onSelectPortsOnly: function(keys)   // 보드 번호 클릭 시 해당 포트들만 선택(기존 선택 교체)
     *   onBoardToggleMany: function(pcs)    // 보드 단위 선택(클릭/드래그): pc 배열을 토글 처리
     *   onClearSelection: function()       // 빈 영역 더블클릭 시 전체 선택 해제
     * }} options
     */
    function init(options) {
        if (!options || !options.api) return;
        opts = {
            gridId: options.gridId || "dashBoardGrid",
            chamberButtonsId: options.chamberButtonsId || "dashChamberButtons",
            onChamberSelect: options.onChamberSelect,
            onPortSelect: options.onPortSelect,
            onPortSelectRange: options.onPortSelectRange,
            onSelectPortsOnly: options.onSelectPortsOnly,
            onBoardToggleMany: options.onBoardToggleMany,
            onClearSelection: options.onClearSelection
        };
        api = options.api;
        portElByKey.clear();
        portSigByKey.clear();
        tileByPc.clear();
        gridBuiltForChamber = 0;
        gridBuiltSig = "";
        gridFitSig = "";
        buildChamberButtons();
        bindEvents();
    }

    function destroy() {
        if (selectionRectEl && selectionRectEl.parentNode) selectionRectEl.parentNode.removeChild(selectionRectEl);
        selectionRectEl = null;
        dragStart = null;
        dragJustEnded = false;
        api = null;
        opts = null;
        portElByKey.clear();
        portSigByKey.clear();
        tileByPc.clear();
        gridBuiltForChamber = 0;
        gridBuiltSig = "";
        gridFitSig = "";
    }

    var BoardPortStatus = {
        init: init,
        destroy: destroy,
        update: render,
        ensureBuilt: ensureBoardGridBuilt,
        requestGridFit: requestGridFit,
        buildChamberButtons: buildChamberButtons,
        setChamberButtonsActive: setChamberButtonsActive
    };

    if (typeof module !== "undefined" && module.exports) {
        module.exports = BoardPortStatus;
    } else {
        global.BoardPortStatus = BoardPortStatus;
    }
})(typeof window !== "undefined" ? window : this);
