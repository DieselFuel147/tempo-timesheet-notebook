// Requires: npm i @mui/material @mui/icons-material @emotion/react @emotion/styled

import React, { useState, useRef, useEffect, useMemo, useCallback } from "react";
import {
  ThemeProvider,
  createTheme,
  CssBaseline,
  Box,
  Paper,
  Typography,
  AppBar,
  Toolbar,
  IconButton,
  Button,
  Chip,
  InputBase,
  Stack,
} from "@mui/material";
import {
  Edit as PencilIcon,
  Check as CheckIcon,
  RestartAlt as ResetIcon,
  AccessTime as ClockIcon,
  KeyboardArrowUp as ChevronUpIcon,
  KeyboardArrowDown as ChevronDownIcon,
  Link as LinkIcon,
  Undo as UndoIcon,
} from "@mui/icons-material";

// ---- constants -------------------------------------------------------
const IDLE_THRESHOLD_SEC = 4;   // real seconds of no typing before an entry closes
const PX_PER_MIN = 14;          // vertical px per simulated minute (1 real sec = 1 sim min)
const MIN_BLOCK_PX = 40;
const MIN_DUR = 1;              // minimum entry duration, in simulated minutes
const BASE_HOUR = 9;            // ledger clock starts at 9:00 AM
const COLORS = ["#2F6E5C", "#8A6A2F", "#4A5D8A", "#7A4A5D"];
const GAP_EPS = 0.05;

const theme = createTheme({
  palette: {
    mode: "light",
    primary: { main: "#1F2B22" },
    secondary: { main: "#B5402C" },
    warning: { main: "#A9822E" },
    background: { default: "#DED9CA", paper: "#EDEFE7" },
    text: { primary: "#1F2B22", secondary: "#55645A" },
  },
  shape: { borderRadius: 6 },
  typography: {
    fontFamily: "'IBM Plex Sans', sans-serif",
    button: { textTransform: "none", fontWeight: 500 },
  },
});

function makeBlock(id) {
  return { id, start: null, end: null, text: "", closed: false, summary: null, ticketId: "" };
}

function fmtClock(simMin) {
  const total = BASE_HOUR * 60 + Math.max(0, simMin);
  let h = Math.floor(total / 60) % 24;
  const m = Math.floor(total % 60);
  const ampm = h >= 12 ? "PM" : "AM";
  let h12 = h % 12;
  if (h12 === 0) h12 = 12;
  return `${h12}:${String(m).padStart(2, "0")} ${ampm}`;
}

function fmtDuration(min) {
  const m = Math.max(0, Math.round(min));
  return m < 1 ? "<1m" : `${m}m`;
}

function autoSummary(text) {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return "Untitled entry";
  const short = words.slice(0, 7).join(" ");
  return short + (words.length > 7 ? "…" : "");
}

// ---- editor panel ------------------------------------------------------
// Isolated + memoized so it only re-renders on real content changes, never
// on the timeline's 300ms tick or on expand state — that's what keeps the
// mobile keyboard from getting dropped.
const EditorPanel = React.memo(function EditorPanel({ blocks, onChange, onTicketIdChange, getRefCallback }) {
  const rows = useMemo(() => {
    const out = [];
    blocks.forEach((b, i) => {
      const prev = blocks[i - 1];
      if (prev && prev.closed && b.start !== null && b.start - prev.end > GAP_EPS) {
        out.push({ type: "gap", id: `g-${b.id}`, dur: b.start - prev.end });
      } else if (prev && prev.closed && b.start === null) {
        out.push({ type: "pending-gap", id: `pg-${b.id}` });
      }
      out.push({ type: "block", id: `b-${b.id}`, block: b, colorIndex: i });
    });
    return out;
  }, [blocks]);

  // the single most-recent closed entry additionally bumps its own end time
  // on edit — every other entry is still fully editable, it just never
  // touches timestamps
  const reopenableId = useMemo(() => {
    const n = blocks.length;
    if (n < 2) return null;
    const last = blocks[n - 1];
    const prev = blocks[n - 2];
    if (prev.closed && last.start === null && !last.text) return prev.id;
    return null;
  }, [blocks]);

  const hasOtherActive = useMemo(() => blocks.some((x) => !x.closed && x.start !== null), [blocks]);

  return (
    <Box>
      {blocks.length === 1 && !blocks[0].text && (
        <Typography variant="body2" fontStyle="italic" color="text.secondary">
          Start typing below — the first keystroke opens your first entry.
        </Typography>
      )}
      {rows.map((row) => {
        if (row.type === "gap" || row.type === "pending-gap") {
          return (
            <Stack key={row.id} direction="row" alignItems="center" spacing={1} sx={{ my: 1.5 }}>
              <Box sx={{ flex: 1, borderTop: "1px dashed #C99089" }} />
              <Typography variant="caption" sx={{ fontFamily: "'IBM Plex Mono', monospace", color: "secondary.main" }}>
                {row.type === "gap" ? `gap · ${fmtDuration(row.dur)}` : "gap · paused"}
              </Typography>
              <Box sx={{ flex: 1, borderTop: "1px dashed #C99089" }} />
            </Stack>
          );
        }

        const b = row.block;
        const color = COLORS[row.colorIndex % COLORS.length];
        const isReopenable = b.id === reopenableId;

        return (
          <Box
            key={row.id}
            sx={{
              mb: 1,
              pl: 1.5,
              borderLeft: `3px solid ${color}`,
              border: isReopenable ? "1px dashed" : "1px dashed transparent",
              borderLeftWidth: 3,
              borderLeftColor: color,
              borderColor: isReopenable ? "warning.main" : "transparent",
              borderRadius: isReopenable ? 1 : 0,
              py: isReopenable ? 0.5 : 0,
            }}
          >
            <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 0.5 }}>
              {/* primary field: ticket ID, always editable, no validation */}
              <InputBase
                value={b.ticketId}
                onChange={(e) => onTicketIdChange(b.id, e.target.value)}
                placeholder="ABC-1234"
                sx={{
                  fontFamily: "'IBM Plex Mono', monospace",
                  fontWeight: 700,
                  fontSize: 12,
                  letterSpacing: "0.03em",
                  border: "1px solid #C9CFC5",
                  borderRadius: 1,
                  px: 1,
                  py: 0.1,
                  bgcolor: "#fff",
                  width: 96,
                  "& input": { textTransform: "uppercase" },
                }}
              />
              <Chip
                size="small"
                label={
                  <Stack direction="row" alignItems="center" spacing={0.5}>
                    <span>
                      {b.start === null ? "waiting…" : `${fmtClock(b.start)} ${b.closed ? `– ${fmtClock(b.end)}` : "– now"}`}
                    </span>
                    {isReopenable && (
                      <Stack direction="row" alignItems="center" spacing={0.3} sx={{ opacity: 0.85, ml: 0.5 }}>
                        <UndoIcon sx={{ fontSize: 12 }} />
                        <span>tap to continue</span>
                      </Stack>
                    )}
                  </Stack>
                }
                sx={{
                  bgcolor: color,
                  color: "#F4F5EF",
                  fontFamily: "'IBM Plex Mono', monospace",
                  fontSize: "11px",
                  height: 22,
                  "& .MuiChip-label": { px: 1 },
                }}
              />
            </Stack>
            <InputBase
              inputRef={getRefCallback(b.id)}
              fullWidth
              multiline
              value={b.text}
              placeholder={
                b.closed
                  ? ""
                  : b.start === null && hasOtherActive
                  ? "Type here to start a new entry — closes the current one…"
                  : "Type a note…"
              }
              onChange={(e) => onChange(b.id, e.target.value, e.target)}
              sx={{
                fontSize: "16px",
                color: b.closed ? "text.secondary" : "text.primary",
                lineHeight: "28px",
              }}
            />
          </Box>
        );
      })}
    </Box>
  );
});

function TimesheetSplitViewInner() {
  const sessionStartRef = useRef(Date.now());
  const lastActivityRef = useRef(null);
  const nextIdRef = useRef(2);
  const textareaRefs = useRef({});
  const refCache = useRef(new Map());
  const blocksRef = useRef([]);

  const [blocks, setBlocks] = useState([makeBlock(1)]);
  const [tick, setTick] = useState(0);
  const [editingId, setEditingId] = useState(null);
  const [draftSummary, setDraftSummary] = useState("");
  const [expandedId, setExpandedId] = useState(null);

  useEffect(() => {
    blocksRef.current = blocks;
  }, [blocks]);

  const elapsedMin = useCallback((epochMs) => (epochMs - sessionStartRef.current) / 1000, []);

  const getRefCallback = useCallback((id) => {
    if (!refCache.current.has(id)) {
      refCache.current.set(id, (el) => {
        textareaRefs.current[id] = el;
      });
    }
    return refCache.current.get(id);
  }, []);

  useEffect(() => {
    const iv = setInterval(() => {
      setTick((t) => t + 1);
      setBlocks((prev) => {
        const activeIdx = prev.findIndex((b) => !b.closed && b.start !== null);
        if (activeIdx === -1 || !lastActivityRef.current) return prev;
        const idleSec = (Date.now() - lastActivityRef.current) / 1000;
        if (idleSec >= IDLE_THRESHOLD_SEC) {
          return prev.map((b, i) =>
            i === activeIdx ? { ...b, closed: true, end: elapsedMin(lastActivityRef.current) } : b
          );
        }
        return prev;
      });
    }, 300);
    return () => clearInterval(iv);
  }, [elapsedMin]);

  useEffect(() => {
    const first = blocks[0];
    if (first && textareaRefs.current[first.id]) {
      textareaRefs.current[first.id].focus();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // note text: the only branch that ever touches timestamps is the blank
  // trailing entry (starts fresh, optionally closing whatever was active)
  // and the single reopenable entry (bumps its own end to now). Every other
  // entry just gets its text updated.
  const handleTextChange = useCallback(
    (id, value, el) => {
      const now = Date.now();
      lastActivityRef.current = now;
      setBlocks((prev) => {
        const idx = prev.findIndex((b) => b.id === id);
        const b = prev[idx];
        const isLast = idx === prev.length - 1;

        if (b.closed && idx === prev.length - 2) {
          const trailing = prev[prev.length - 1];
          if (trailing.start === null && !trailing.text) {
            return prev.map((x, i) => (i === idx ? { ...x, closed: false, end: null, text: value } : x));
          }
        }

        if (isLast && b.start === null) {
          const activeIdx = prev.findIndex((x) => !x.closed && x.start !== null);
          const withStart = prev.map((x, i) => {
            if (activeIdx !== -1 && i === activeIdx) return { ...x, closed: true, end: elapsedMin(now) };
            if (i === idx) return { ...x, text: value, start: elapsedMin(now) };
            return x;
          });
          return [...withStart, makeBlock(nextIdRef.current++)];
        }

        // any other entry, open or closed: text only, timestamps untouched
        return prev.map((x) => (x.id === id ? { ...x, text: value } : x));
      });
      if (el) {
        el.style.height = "auto";
        el.style.height = el.scrollHeight + "px";
      }
    },
    [elapsedMin]
  );

  // ticket ID is pure metadata — editing it never counts as "activity" and
  // never touches start/end/closed, on any entry including the blank one
  const handleTicketIdChange = useCallback((id, value) => {
    setBlocks((prev) => prev.map((x) => (x.id === id ? { ...x, ticketId: value } : x)));
  }, []);

  const handleReset = () => {
    sessionStartRef.current = Date.now();
    lastActivityRef.current = null;
    nextIdRef.current = 2;
    refCache.current = new Map();
    textareaRefs.current = {};
    setBlocks([makeBlock(1)]);
    setEditingId(null);
    setExpandedId(null);
  };

  const openSummaryEditor = (b, e) => {
    e.stopPropagation();
    setDraftSummary(b.summary || autoSummary(b.text));
    setEditingId(b.id);
  };

  const saveSummary = (id) => {
    setBlocks((prev) => prev.map((x) => (x.id === id ? { ...x, summary: draftSummary.trim() || null } : x)));
    setEditingId(null);
  };

  const absorbUp = (blockId, e) => {
    e.stopPropagation();
    setBlocks((prev) => {
      const idx = prev.findIndex((b) => b.id === blockId);
      const prevBlock = prev[idx - 1];
      if (!prevBlock || !prevBlock.closed) return prev;
      return prev.map((b) => (b.id === blockId ? { ...b, start: prevBlock.end } : b));
    });
  };

  const absorbDown = (blockId, e) => {
    e.stopPropagation();
    setBlocks((prev) => {
      const idx = prev.findIndex((b) => b.id === blockId);
      const nextBlock = prev[idx + 1];
      if (!nextBlock || !nextBlock.closed) return prev;
      return prev.map((b) => (b.id === blockId ? { ...b, end: nextBlock.start } : b));
    });
  };

  // merge: strictly two consecutive closed entries, fused into one — text
  // concatenated, span extended to close the gap, single re-derived summary.
  // Not for linking entries that are far apart; that's what a shared ticket
  // ID is for (see the color-grouping logic below).
  const mergeWithNeighbor = (blockId, direction, e) => {
    e.stopPropagation();
    setBlocks((prev) => {
      const idx = prev.findIndex((b) => b.id === blockId);
      const otherIdx = direction === "prev" ? idx - 1 : idx + 1;
      const other = prev[otherIdx];
      if (!other || !other.closed) return prev;
      const a = prev[idx];
      const earlier = direction === "prev" ? other : a;
      const later = direction === "prev" ? a : other;
      const merged = {
        ...earlier,
        end: later.end,
        text: [earlier.text, later.text].filter(Boolean).join("\n"),
        summary: null,
        ticketId: earlier.ticketId || later.ticketId,
      };
      const lo = Math.min(idx, otherIdx);
      const hi = Math.max(idx, otherIdx);
      return [...prev.slice(0, lo), merged, ...prev.slice(hi + 1)];
    });
    setExpandedId(null);
  };

  const toggleExpand = (block) => {
    if (!block.closed) return;
    setExpandedId((prev) => (prev === block.id ? null : block.id));
  };

  const onPinDown = (blockId, edge, e) => {
    e.preventDefault();
    e.stopPropagation();
    const snapshot = blocksRef.current;
    const idx = snapshot.findIndex((b) => b.id === blockId);
    const block = snapshot[idx];
    const prevBlock = snapshot[idx - 1];
    const nextBlock = snapshot[idx + 1];
    const startClientY = e.clientY;
    const startVal = edge === "start" ? block.start : block.end;

    const onMove = (ev) => {
      const deltaMin = (ev.clientY - startClientY) / PX_PER_MIN;
      let val = startVal + deltaMin;
      if (edge === "start") {
        const min = prevBlock && prevBlock.closed ? prevBlock.end : 0;
        const max = block.end - MIN_DUR;
        val = Math.min(Math.max(val, min), max);
        setBlocks((bs) => bs.map((b) => (b.id === blockId ? { ...b, start: val } : b)));
      } else {
        const min = block.start + MIN_DUR;
        const max = nextBlock && nextBlock.start !== null ? nextBlock.start : elapsedMin(Date.now());
        val = Math.min(Math.max(val, min), max);
        setBlocks((bs) => bs.map((b) => (b.id === blockId ? { ...b, end: val } : b)));
      }
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  // build timeline render items + stats (recomputed live, every tick).
  // Color/connector grouping is now driven purely by matching, non-empty
  // ticketId strings — entries keep independent summaries and durations.
  const { items, connectors, totalLogged, totalGap, entryCount, ticketCount } = useMemo(() => {
    const nowE = elapsedMin(Date.now());

    const ticketCounts = {};
    blocks.forEach((b) => {
      const tid = b.ticketId && b.ticketId.trim();
      if (tid) ticketCounts[tid] = (ticketCounts[tid] || 0) + 1;
    });

    let cursor = 0;
    let colorCount = 0;
    let loggedSum = 0;
    let gapSum = 0;
    let count = 0;
    const ticketColorMap = {};
    const ticketPositions = {};
    const out = [];

    blocks.forEach((b) => {
      if (b.start === null) {
        if (cursor < nowE - 0.02 && blocks.length > 1) {
          out.push({ type: "pending-gap", id: `pg-${b.id}`, from: cursor, to: nowE });
          gapSum += nowE - cursor;
        }
        return;
      }
      const displayEnd = b.closed ? b.end : nowE;
      if (cursor < b.start - 0.02) {
        out.push({ type: "gap", id: `g-${b.id}`, from: cursor, to: b.start });
        gapSum += b.start - cursor;
      }

      const tid = b.ticketId && b.ticketId.trim();
      let color;
      if (tid) {
        if (!(tid in ticketColorMap)) {
          ticketColorMap[tid] = COLORS[colorCount % COLORS.length];
          colorCount += 1;
        }
        color = ticketColorMap[tid];
      } else {
        color = COLORS[colorCount % COLORS.length];
        colorCount += 1;
      }

      count += 1;
      loggedSum += displayEnd - b.start;
      const topPx = 16 + b.start * PX_PER_MIN;
      const bottomPx = 16 + displayEnd * PX_PER_MIN;
      if (tid) {
        ticketPositions[tid] = ticketPositions[tid] || [];
        ticketPositions[tid].push({ top: topPx, bottom: bottomPx });
      }
      out.push({
        type: "block",
        id: `b-${b.id}`,
        block: b,
        start: b.start,
        end: displayEnd,
        color,
        ticketId: tid || null,
        ticketCount: tid ? ticketCounts[tid] : 0,
      });
      cursor = displayEnd;
    });

    const conns = [];
    Object.entries(ticketPositions).forEach(([tid, positions]) => {
      for (let i = 0; i < positions.length - 1; i++) {
        conns.push({
          id: `conn-${tid}-${i}`,
          top: positions[i].bottom,
          height: Math.max(positions[i + 1].top - positions[i].bottom, 0),
          color: ticketColorMap[tid],
        });
      }
    });

    const ticketsSeen = new Set();
    let untracked = 0;
    blocks.forEach((b) => {
      if (b.start === null) return;
      const tid = b.ticketId && b.ticketId.trim();
      if (tid) ticketsSeen.add(tid);
      else untracked += 1;
    });

    return {
      items: out,
      connectors: conns,
      totalLogged: loggedSum,
      totalGap: gapSum,
      entryCount: count,
      ticketCount: ticketsSeen.size + untracked,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blocks, elapsedMin, tick]);

  const nowElapsed = elapsedMin(Date.now());
  const timelineHeight = Math.max(nowElapsed * PX_PER_MIN + 60, 320);
  const isLiveTyping = blocks.some((b) => b.start !== null && !b.closed);

  return (
    <Box sx={{ bgcolor: "background.default", minHeight: "100vh", display: "flex", justifyContent: "center", p: 2 }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans:wght@400;500;600&display=swap');
        @keyframes pulseDot { 0%,100% { opacity: 1; } 50% { opacity: 0.35; } }
        .live-dot { animation: pulseDot 1.6s ease-in-out infinite; }
        @keyframes gapStripe { from { background-position: 0 0; } to { background-position: 28px 0; } }
        .gap-live { animation: gapStripe 1.2s linear infinite; }
        @media (prefers-reduced-motion: reduce) { .live-dot, .gap-live { animation: none; } }
      `}</style>

      <Paper elevation={8} sx={{ width: "100%", maxWidth: 1100, overflow: "hidden", borderRadius: 2 }}>
        <AppBar position="static" elevation={0} color="primary">
          <Toolbar sx={{ justifyContent: "space-between" }}>
            <Stack direction="row" alignItems="center" spacing={1.5}>
              <ClockIcon sx={{ color: "#E7C9BF" }} />
              <Box>
                <Typography variant="subtitle1" sx={{ lineHeight: 1.1 }}>Ledger</Typography>
                <Typography variant="caption" sx={{ color: "#B9C7BC", fontFamily: "'IBM Plex Mono', monospace" }}>
                  notes that log their own time
                </Typography>
              </Box>
            </Stack>
            <Stack direction="row" alignItems="center" spacing={2}>
              <Stack direction="row" alignItems="center" spacing={1}>
                <Box
                  className={isLiveTyping ? "live-dot" : ""}
                  sx={{ width: 8, height: 8, borderRadius: "50%", bgcolor: isLiveTyping ? "secondary.main" : "#5A6A5E" }}
                />
                <Typography variant="caption" sx={{ fontFamily: "'IBM Plex Mono', monospace" }}>
                  {isLiveTyping ? "logging" : "idle"} · {fmtClock(nowElapsed)}
                </Typography>
              </Stack>
              <Button size="small" startIcon={<ResetIcon fontSize="small" />} onClick={handleReset} sx={{ color: "#EDEFE7" }}>
                Reset
              </Button>
            </Stack>
          </Toolbar>
        </AppBar>

        <Box sx={{ px: 3, py: 1, bgcolor: "#E2E5D8", borderBottom: "1px solid #D7DBCC" }}>
          <Typography variant="caption" color="text.secondary">
            Every entry stays editable — only the dashed one (the most recent) also bumps its end time when you add to
            it. Give two entries the same ticket ID and they auto-color/connect, but keep independent summaries. Tap a
            closed entry on the ruler for gap-absorb arrows, or to merge it with an adjacent entry into one.
          </Typography>
        </Box>

        <Stack direction={{ xs: "column", md: "row" }} sx={{ minHeight: 480 }}>
          <Box
            sx={{
              flex: 1,
              p: 2.5,
              overflowY: "auto",
              maxHeight: 620,
              borderRight: "1px solid #D7DBCC",
              backgroundImage: "repeating-linear-gradient(#EDEFE7, #EDEFE7 27px, #DEE2D2 28px)",
            }}
          >
            <EditorPanel
              blocks={blocks}
              onChange={handleTextChange}
              onTicketIdChange={handleTicketIdChange}
              getRefCallback={getRefCallback}
            />
          </Box>

          <Box sx={{ width: "100%", maxWidth: 360, overflowY: "auto", maxHeight: 620, bgcolor: "#F4F5EF" }}>
            <Box sx={{ position: "relative", height: timelineHeight, p: "16px 16px 16px 56px" }}>
              {Array.from({ length: Math.ceil(timelineHeight / PX_PER_MIN) + 1 }).map((_, i) => {
                const simMin = i;
                if (simMin * PX_PER_MIN > timelineHeight) return null;
                const major = simMin % 5 === 0;
                return (
                  <Box key={i} sx={{ position: "absolute", top: 16 + simMin * PX_PER_MIN, left: 0, width: "100%" }}>
                    {major && (
                      <Typography
                        variant="caption"
                        sx={{ position: "absolute", left: 0, top: -6, fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: "#8A9990" }}
                      >
                        {fmtClock(simMin)}
                      </Typography>
                    )}
                    <Box sx={{ position: "absolute", left: major ? 44 : 48, top: 0, width: major ? 10 : 5, borderTop: `1px solid ${major ? "#B9C0AE" : "#DDE1D4"}` }} />
                  </Box>
                );
              })}

              <Box sx={{ position: "absolute", left: 56, top: 16, bottom: 16, width: 1, bgcolor: "#D7DBCC" }} />

              {connectors.map((c) => (
                <Box key={c.id} sx={{ position: "absolute", left: 56, top: c.top, height: c.height, borderLeft: `2px dashed ${c.color}`, opacity: 0.55 }} />
              ))}

              {items.map((it, i) => {
                if (it.type === "gap" || it.type === "pending-gap") {
                  const top = 16 + it.from * PX_PER_MIN;
                  const h = Math.max((it.to - it.from) * PX_PER_MIN, 6);
                  return (
                    <Box
                      key={it.id}
                      title={`gap ${fmtDuration(it.to - it.from)}`}
                      className={it.type === "pending-gap" ? "gap-live" : ""}
                      sx={{
                        position: "absolute",
                        left: 60,
                        top,
                        height: h,
                        width: 8,
                        background: "repeating-linear-gradient(135deg, #E7C9BF, #E7C9BF 4px, transparent 4px, transparent 8px)",
                      }}
                    />
                  );
                }

                const b = it.block;
                const top = 16 + it.start * PX_PER_MIN;
                const h = Math.max((it.end - it.start) * PX_PER_MIN, MIN_BLOCK_PX);
                const label = b.summary || autoSummary(b.text);
                const editing = editingId === b.id;
                const expanded = expandedId === b.id;
                const showUp = i > 0 && items[i - 1].type === "gap";
                const showDown = i < items.length - 1 && items[i + 1].type === "gap";

                const bIdx = blocks.findIndex((x) => x.id === b.id);
                const canMergePrev = bIdx > 0 && blocks[bIdx - 1].closed;
                const canMergeNext = bIdx < blocks.length - 1 && blocks[bIdx + 1].closed;

                return (
                  <Box key={it.id} sx={{ position: "absolute", left: 60, top, height: h, right: 0 }}>
                    <Paper
                      onClick={() => toggleExpand(b)}
                      elevation={0}
                      sx={{
                        position: "relative",
                        height: "100%",
                        bgcolor: it.color,
                        color: "#F4F5EF",
                        borderRadius: 1,
                        p: "6px 8px",
                        display: "flex",
                        flexDirection: "column",
                        justifyContent: "center",
                        gap: 0.25,
                        boxShadow: expanded ? "0 0 0 2px #1F2B22" : "0 2px 5px rgba(31,43,34,0.18)",
                        cursor: b.closed ? "pointer" : "default",
                      }}
                    >
                      {it.ticketId && (
                        <Chip
                          size="small"
                          icon={it.ticketCount > 1 ? <LinkIcon sx={{ fontSize: 10 }} /> : undefined}
                          label={it.ticketCount > 1 ? `${it.ticketId} · ${it.ticketCount}` : it.ticketId}
                          sx={{
                            position: "absolute",
                            top: 4,
                            right: 4,
                            height: 16,
                            bgcolor: "rgba(31,43,34,0.35)",
                            color: "#fff",
                            fontSize: 9,
                            fontWeight: 700,
                            fontFamily: "'IBM Plex Mono', monospace",
                          }}
                        />
                      )}

                      <Typography sx={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, opacity: 0.9 }}>
                        {fmtClock(it.start)}–{b.closed ? fmtClock(it.end) : "now"} · {fmtDuration(it.end - it.start)}
                      </Typography>

                      {editing ? (
                        <Stack direction="row" alignItems="center" spacing={0.5} onClick={(e) => e.stopPropagation()}>
                          <InputBase
                            autoFocus
                            value={draftSummary}
                            onChange={(e) => setDraftSummary(e.target.value)}
                            onKeyDown={(e) => e.key === "Enter" && saveSummary(b.id)}
                            onBlur={() => saveSummary(b.id)}
                            sx={{ fontSize: 13, bgcolor: "#fff", borderRadius: 0.5, px: 0.5, width: "100%", color: "text.primary" }}
                          />
                          <CheckIcon sx={{ fontSize: 14 }} />
                        </Stack>
                      ) : (
                        <Stack direction="row" alignItems="center" spacing={0.5}>
                          <Typography noWrap sx={{ fontSize: 12 }}>{label}</Typography>
                          <IconButton size="small" onClick={(e) => openSummaryEditor(b, e)} sx={{ p: 0.2, color: "#F4F5EF" }}>
                            <PencilIcon sx={{ fontSize: 12 }} />
                          </IconButton>
                        </Stack>
                      )}

                      {expanded && showUp && (
                        <IconButton
                          onClick={(e) => absorbUp(b.id, e)}
                          title="Extend up to absorb the gap"
                          size="small"
                          sx={{
                            position: "absolute", top: -14, left: "50%", transform: "translateX(-50%)",
                            width: 22, height: 22, bgcolor: "secondary.main", border: "2px solid #F4F5EF",
                            "&:hover": { bgcolor: "secondary.dark" },
                          }}
                        >
                          <ChevronUpIcon sx={{ fontSize: 14, color: "#F4F5EF" }} />
                        </IconButton>
                      )}
                      {expanded && showDown && (
                        <IconButton
                          onClick={(e) => absorbDown(b.id, e)}
                          title="Extend down to absorb the gap"
                          size="small"
                          sx={{
                            position: "absolute", bottom: -14, left: "50%", transform: "translateX(-50%)",
                            width: 22, height: 22, bgcolor: "secondary.main", border: "2px solid #F4F5EF",
                            "&:hover": { bgcolor: "secondary.dark" },
                          }}
                        >
                          <ChevronDownIcon sx={{ fontSize: 14, color: "#F4F5EF" }} />
                        </IconButton>
                      )}

                      {b.closed && (
                        <>
                          <Box
                            onPointerDown={(e) => onPinDown(b.id, "start", e)}
                            title="Drag to adjust start time"
                            sx={{ position: "absolute", left: -6, top: -6, width: 16, height: 16, borderRadius: "50%", bgcolor: "warning.main", border: "2px solid #F4F5EF", cursor: "ns-resize", touchAction: "none" }}
                          />
                          <Box
                            onPointerDown={(e) => onPinDown(b.id, "end", e)}
                            title="Drag to adjust end time"
                            sx={{ position: "absolute", left: -6, bottom: -6, width: 16, height: 16, borderRadius: "50%", bgcolor: "warning.main", border: "2px solid #F4F5EF", cursor: "ns-resize", touchAction: "none" }}
                          />
                        </>
                      )}
                    </Paper>

                    {expanded && (canMergePrev || canMergeNext) && (
                      <Stack direction="row" spacing={1} sx={{ mt: 0.5 }} onClick={(e) => e.stopPropagation()}>
                        {canMergePrev && (
                          <Button
                            size="small"
                            variant="contained"
                            color="primary"
                            startIcon={<ChevronUpIcon sx={{ fontSize: 14 }} />}
                            onClick={(e) => mergeWithNeighbor(b.id, "prev", e)}
                            sx={{ fontSize: 11, py: 0.3 }}
                          >
                            Merge with previous
                          </Button>
                        )}
                        {canMergeNext && (
                          <Button
                            size="small"
                            variant="contained"
                            color="primary"
                            startIcon={<ChevronDownIcon sx={{ fontSize: 14 }} />}
                            onClick={(e) => mergeWithNeighbor(b.id, "next", e)}
                            sx={{ fontSize: 11, py: 0.3 }}
                          >
                            Merge with next
                          </Button>
                        )}
                      </Stack>
                    )}
                  </Box>
                );
              })}
            </Box>
          </Box>
        </Stack>

        <Stack direction="row" flexWrap="wrap" alignItems="center" justifyContent="space-between" sx={{ px: 3, py: 1.5, bgcolor: "primary.main", color: "#EDEFE7" }}>
          <Stack direction="row" spacing={2.5}>
            <Typography variant="caption" sx={{ fontFamily: "'IBM Plex Mono', monospace" }}>entries · {entryCount}</Typography>
            <Typography variant="caption" sx={{ fontFamily: "'IBM Plex Mono', monospace" }}>tickets · {ticketCount}</Typography>
            <Typography variant="caption" sx={{ fontFamily: "'IBM Plex Mono', monospace" }}>logged · {fmtDuration(totalLogged)}</Typography>
            <Typography variant="caption" sx={{ fontFamily: "'IBM Plex Mono', monospace", color: "#E7C9BF" }}>gaps · {fmtDuration(totalGap)}</Typography>
          </Stack>
          <Typography variant="caption" sx={{ fontFamily: "'IBM Plex Mono', monospace", color: "#8AA091" }}>tap entry · arrows + merge</Typography>
        </Stack>
      </Paper>
    </Box>
  );
}

export default function TimesheetSplitViewMUI() {
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <TimesheetSplitViewInner />
    </ThemeProvider>
  );
}