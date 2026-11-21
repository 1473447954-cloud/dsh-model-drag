/**
 * DSH plugin: dsh-model-drag — client half.
 * Generated from engine.js by build-client.mjs; edit engine.js and rebuild.
 */
window.__ModuleLoader__.load({
  id: 'dsh-model-drag',
  factory: (require) => {
  /*!
   * DSH Model Drag Sort — drag-reorder engine for the model picker menu.
   *
   * Structured architecture (v2.0.0) — every behavior is a rule, every rule has
   * one home:
   *
   *   CONFIG        every tunable (thresholds, timings, easing, z, storage keys)
   *   CONTRACT      the stable DOM contract as data — the only place selectors live
   *   CSS           the style rules the engine injects (deduped by tag id)
   *   Dom           query primitives over the DOM contract
   *   Storage       persistence rules (load + sanitize + save)
   *   flipToRest    FLIP landing animator (token-guarded cleanups)
   *   AutoScroller  timer-driven auto-scroll (rAF-independent)
   *   Layout        pure geometry: displacement simulation, slot midpoints,
   *                 the drag boundary
   *   ClickGuard    click suppression bound to the drag lifecycle
   *   POLICIES      RowPolicy / GroupPolicy — the rule set per drag mode; each
   *                 policy carries its own CSS class names, so no mode branches
   *                 exist anywhere else in the engine
   *   Session       pointer state machine: PRESSED → READY → DRAGGING. Owns
   *                 exactly one structural event: onStructureChanged — the
   *                 host reflowing or detaching the list mid-drag is heard
   *                 here (never polled), and resolves to re-anchor or abort.
   *   Replay        saved-order re-application (single canonical implementation)
   *   Host          install controller: listeners, one observer routed to
   *                 either the active session or Replay, the scrollIntoView
   *                 rule that inserts our reorder between the host's menu
   *                 mount and its native bookmark scroll, and `gate` — the
   *                 single exception rule every session entry runs behind.
   *
   * Event discipline: pointer events drive geometry; MutationObserver drives
   * structure. The high-frequency pointer path never re-reads the DOM to
   * "check" for host changes — structure arrives as a notification, and every
   * terminal path (settle, release, structuralAbort, abort) deregisters
   * itself from Host.active, so no path can leave a zombie session behind.
   *
   * Environment-agnostic: runs inside the DSH Web UI (client module loader) and
   * in the standalone temp harness page. Installs per document; dispose() is
   * idempotent and safe to call mid-drag.
   */
  (function (global) {
    'use strict';

    // ================================================================== config

    const CONFIG = {
      storage: {
        rowsKey: 'dsh-plugin.model-drag-sort.order.v1',
        groupsKey: 'dsh-plugin.model-drag-sort.groups.v1',
      },
      gesture: {
        dragThresholdPx: 5,   // movement before a press becomes a drag
        longPressMs: 220,     // hold before drag intent is declared
        guardReleaseMs: 60,   // click-guard linger after release
      },
      scroll: {
        edgeZonePx: 30,       // band at viewport edges that auto-scrolls
        maxSpeedPxPerFrame: 14,
        tickMs: 16,           // rAF-independent: works in occluded windows
        maxTickMs: 50,
      },
      animation: {
        siblingEase: 'transform 170ms cubic-bezier(0.22, 0.72, 0.24, 1)',
        landEase: 'transform 160ms cubic-bezier(0.22, 0.72, 0.24, 1)',
        landSettleMs: 220,
        groupDimEase: 'opacity 150ms ease',
        groupDimOpacity: 0.55,
      },
      z: { draggingRow: 60, draggingGroup: 55 },
    };

    /**
     * The stable DOM contract, as data. Every selector the engine matches lives
     * here; attribute-based (plus one host class: the viewport) so host
     * class-hash changes never break it.
     */
    const CONTRACT = {
      row: 'button[role="menuitemradio"]',
      section: 'section[data-menu-group]',
      heading: '[data-menu-group-heading]',
      modelId: '[data-model-id]',
      providerId: '[data-provider-id]',
      viewportClass: 'scrollable',
    };

    /**
     * Every class-name token the engine paints, as data — one home for the CSS
     * rules and the classList operations alike; the policies carry their own
     * tokens so no mode branch exists anywhere else.
     */
    const CLASS = {
      pressing: 'dsh-mds-pressing',
      active: 'dsh-mds-active',
      sortable: 'dsh-mds-sortable',
      dragging: 'dsh-mds-dragging',
      groupDragging: 'dsh-mds-group-dragging',
      groupActive: 'dsh-mds-group-active',
      styleTagId: 'dsh-model-drag-sort-style',
    };

    const CSS = [
      // Hover keeps the host's own cursors. From the moment a press lands on a
      // draggable unit until it is released, the whole menu (and during an
      // active drag, the whole page) shows the grabbing hand — the pointer
      // never flickers back to arrow/pointer over rows, gaps, or other groups.
      `.${CLASS.pressing}, .${CLASS.pressing} * { cursor: grabbing !important; }`,
      `.${CLASS.active}, .${CLASS.active} * {`,
      '  cursor: grabbing !important;',
      '  user-select: none !important;',
      '  -webkit-user-select: none !important;',
      '}',
      `${CONTRACT.row}.${CLASS.dragging} {`,
      `  z-index: ${CONFIG.z.draggingRow};`,
      '  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.38), 0 2px 8px rgba(0, 0, 0, 0.28);',
      '}',
      `${CONTRACT.section}.${CLASS.groupDragging} { z-index: ${CONFIG.z.draggingGroup}; }`,
      `${CONTRACT.section}.${CLASS.groupDragging} > ${CONTRACT.heading} {`,
      '  background: rgba(128, 128, 128, 0.12);',
      '  border-radius: 8px;',
      '}',
      `.${CLASS.groupActive} ${CONTRACT.section} { transition: ${CONFIG.animation.groupDimEase}; }`,
      `.${CLASS.groupActive} ${CONTRACT.section}:not(.${CLASS.groupDragging}) { opacity: ${CONFIG.animation.groupDimOpacity}; }`,
      // Host headings are position:sticky. Sticky is resolved in the section's
      // own coordinate space, then the section's drag transform shifts the
      // painted result — the heading visibly drifts off its group onto some
      // other row mid-drag. While a group drag is active, keep every heading
      // in normal flow so it travels exactly with its section; stickiness
      // resumes the moment the drag ends. Sticky reserves flow space, so the
      // switch itself never shifts layout.
      `.${CLASS.groupActive} ${CONTRACT.section} > ${CONTRACT.heading} {`,
      '  position: static !important;',
      '}',
      `.${CLASS.sortable} > ${CONTRACT.section} > ${CONTRACT.heading} {`,
      '  user-select: none;',
      '  -webkit-user-select: none;',
      '  -webkit-user-drag: none;',
      '}'
    ].join('\n');

    // ============================================================ dom contract

    const Dom = {
      isModelRow(el) {
        return el instanceof HTMLButtonElement &&
          el.matches(CONTRACT.row) &&
          el.querySelector(CONTRACT.modelId) !== null;
      },
      isModelSection(el) {
        return el instanceof HTMLElement &&
          el.matches(CONTRACT.section) &&
          el.querySelector(CONTRACT.modelId) !== null;
      },
      rowKey(row) {
        const span = row.querySelector(CONTRACT.modelId);
        if (!span) return null;
        return (span.getAttribute('data-provider-id') || '') + '\u0000' +
               (span.getAttribute('data-model-id') || '');
      },
      sectionProvider(section) {
        const span = section.querySelector(CONTRACT.providerId);
        return span ? (span.getAttribute('data-provider-id') || '') : '';
      },
      rowsOf(section) {
        const out = [];
        for (let child = section.firstElementChild; child; child = child.nextElementSibling) {
          if (this.isModelRow(child)) out.push(child);
        }
        return out;
      },
      sectionsOf(viewport) {
        const out = [];
        for (let child = viewport.firstElementChild; child; child = child.nextElementSibling) {
          if (this.isModelSection(child)) out.push(child);
        }
        return out;
      },
      findViewport(el) {
        let node = el.parentElement;
        // Stop at any Document node (not just this realm's document.body) so a
        // cross-document install cannot walk into another realm's APIs.
        while (node && node.nodeType !== Node.DOCUMENT_NODE) {
          if (node.classList.contains(CONTRACT.viewportClass)) return node;
          const overflowY = global.getComputedStyle(node).overflowY;
          if ((overflowY === 'auto' || overflowY === 'scroll') &&
              node.scrollHeight > node.clientHeight + 1) return node;
          node = node.parentElement;
        }
        return null;
      },
      /**
       * Relevance gate for one mutation record: does its target sit inside a
       * menu viewport? Records outside (chat stream, status ticks, …) can never
       * change the menu — the observer skips them without a DOM query.
       */
      recordTouchesViewport(record) {
        const t = record.target;
        if (!(t instanceof Element) || !t.isConnected) return false;
        for (let node = t; node; node = node.parentElement) {
          if (node.nodeType === Node.DOCUMENT_NODE) return false;
          if (node.classList.contains(CONTRACT.viewportClass)) return true;
        }
        return false;
      },
    };

    // ================================================================ storage

    const Storage = {
      load(key, sanitize) {
        try {
          const raw = global.localStorage && global.localStorage.getItem(key);
          return raw === null ? sanitize(null) : sanitize(JSON.parse(raw));
        } catch (err) {
          return sanitize(null); // corrupted JSON / storage unavailable
        }
      },
      save(key, value) {
        try {
          global.localStorage.setItem(key, JSON.stringify(value));
        } catch (err) { /* session-only ordering */ }
      },
      sanitizeRows(v) {
        const out = {};
        if (!v || typeof v !== 'object' || Array.isArray(v)) return out;
        for (const key of Object.keys(v)) {
          if (Array.isArray(v[key])) out[key] = v[key].filter((x) => typeof x === 'string');
        }
        return out;
      },
      sanitizeGroups(v) {
        return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [];
      },
    };

    // ============================================================ fx: flip fx

    function clearTransform(el) {
      // Remove (not blank with 'none') so the host's own CSS transitions survive.
      el.style.removeProperty('transition');
      el.style.removeProperty('transform');
      el.style.removeProperty('will-change');
    }

    /**
     * FLIP an element from wherever it currently renders to its natural
     * (post-reorder) position, then release it to identity. Zero-jump landing.
     * Token-guarded: a newer flip or a fresh drag supersedes the cleanup.
     */
    function flipToRest(el, prevRect, ease, settleMs) {
      const now = el.getBoundingClientRect();
      const dx = prevRect.left - now.left;
      const dy = prevRect.top - now.top;
      const token = (el.__dshMdsFlipToken = (el.__dshMdsFlipToken || 0) + 1);
      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) {
        clearTransform(el);
        return;
      }
      el.style.transition = 'none';
      el.style.transform = `translate3d(${dx}px, ${dy}px, 0)`;
      void el.offsetHeight; // commit the start position before animating
      el.style.transition = ease;
      el.style.transform = 'translate3d(0, 0, 0)';
      // Self-deregistration: a superseded flip must not leave its listener
      // behind, and a transitionend bubbling up from a transitioning
      // descendant must not end this flip early.
      const finish = (event) => {
        if (event && event.target !== el) return;
        el.removeEventListener('transitionend', finish);
        clearTimeout(timer);
        if (el.__dshMdsFlipToken !== token) return; // superseded: styles handled by the newer owner
        clearTransform(el);
      };
      el.addEventListener('transitionend', finish);
      const timer = setTimeout(finish, settleMs);
    }

    // =========================================================== fx: scrolling

    /**
     * Auto-scroll for one session: the pointer's edge-zone depth maps to a
     * scroll speed (capped at the configured max), and a timer drives the loop —
     * rAF stays silent in occluded windows, auto-scroll must not. Only scrolls
     * and forwards the follow update; exceptions surface through Host.gate,
     * the same rule the pointer handlers run behind.
     */
    const AutoScroller = {
      /** Pointer depth into an edge zone → scroll speed (px per tick). */
      edgeSpeed(viewport, pointerY) {
        const rect = viewport.getBoundingClientRect();
        const zone = CONFIG.scroll.edgeZonePx;
        const topDepth = (rect.top + zone) - pointerY;        // >0: into the top zone
        const bottomDepth = pointerY - (rect.bottom - zone);  // >0: into the bottom zone
        if (topDepth > 0) {
          return -Math.ceil(CONFIG.scroll.maxSpeedPxPerFrame * Math.min(1, topDepth / zone));
        }
        if (bottomDepth > 0) {
          return Math.ceil(CONFIG.scroll.maxSpeedPxPerFrame * Math.min(1, bottomDepth / zone));
        }
        return 0;
      },
      start(session) {
        if (session.scrollFrame) return;
        session.scrollFrame = true;
        let last = Date.now();
        const step = () => {
          const viewport = session.unit.viewport;
          if (Host.active !== session || !viewport || session.scrollSpeed === 0) {
            session.scrollFrame = null;
            return;
          }
          const now = Date.now();
          const elapsed = Math.min(now - last, CONFIG.scroll.maxTickMs);
          last = now;
          viewport.scrollTop += session.scrollSpeed * (elapsed / CONFIG.scroll.tickMs);
          Host.gate(session, () => session.update(session.lastPointerY));
          if (session.scrollFrame) global.setTimeout(step, CONFIG.scroll.tickMs);
        };
        global.setTimeout(step, CONFIG.scroll.tickMs);
      },
      stop(session) {
        session.scrollSpeed = 0;
        session.scrollFrame = null;
      },
    };

    // =========================================================== fx: geometry

    /**
     * Pure displacement computation: the siblings' transforms while the dragged
     * unit travels from slot `from` to slot `to`. Simulates the FINAL layout —
     * units may have different heights; walks the vacated boundary honoring each
     * unit's height and the original gaps. Degenerates to the classic one-slot
     * shift for equal-height rows.
     */
    const Layout = {
      shifts(rects, from, to) {
        const n = rects.length;
        const shifts = new Array(n).fill(0);
        if (from === to) return shifts;
        const seq = [];
        for (let i = 0; i < n; i++) if (i !== from) seq.push(i);
        seq.splice(to, 0, from);
        const min = Math.min(from, to);
        const max = Math.max(from, to);
        if (to > from) {
          let running = rects[from].top;
          for (let pos = min; pos <= max; pos++) {
            const idx = seq[pos];
            if (idx === from) continue;
            const r = rects[idx];
            shifts[idx] = running - r.top;
            running += r.height + this.gap(rects, idx, idx + 1);
          }
        } else {
          let runningBottom = rects[from].bottom;
          for (let pos = max; pos >= min; pos--) {
            const idx = seq[pos];
            if (idx === from) continue;
            const r = rects[idx];
            const newTop = runningBottom - r.height;
            shifts[idx] = newTop - r.top;
            runningBottom = newTop - this.gap(rects, idx - 1, idx);
          }
        }
        return shifts;
      },
      gap(rects, a, b) {
        if (a < 0 || b < 0 || a >= rects.length || b >= rects.length) return 0;
        return rects[b].top - rects[a].bottom;
      },
      /** Slot midpoint between adjacent rects (scroll-adjusted). */
      mid(rects, i, scrolled) {
        return (rects[i].bottom + rects[i + 1].top) / 2 - scrolled;
      },
      /** The scrollTop delta since the rects were captured (0 when unscrolled). */
      scrolled(viewport, savedScroll) {
        return viewport ? viewport.scrollTop - savedScroll : 0;
      },
      /** Rest-center Y of the slot `from`, in the rects' capture frame. */
      origCenter(rects, from) {
        return rects[from].top + rects[from].height / 2;
      },
      /**
       * Drag boundary: the dy range keeping the dragged box inside the
       * viewport's content. A transformed box extends its scroll container's
       * scrollable overflow, so an unclamped 1:1 follow would let the drag
       * inflate scrollHeight and let auto-scroll chase empty space forever —
       * the scrollbar shrinking as it goes. Rect differences are
       * content-anchored, so the result stays valid while scrollTop changes.
       */
      contentBounds(viewport, el) {
        if (!viewport) return null;
        const vpr = viewport.getBoundingClientRect();
        const r = el.getBoundingClientRect();
        const contentTop = vpr.top - viewport.scrollTop; // content y=0, viewport-relative
        return {
          min: contentTop - r.top,
          max: contentTop + viewport.scrollHeight - r.top - r.height,
        };
      },
    };

    // ============================================================ click guard

    /**
     * Click suppression follows the drag lifecycle: armed when a drag engages
     * OR a long-press declares drag intent, released shortly after the pointer
     * is — so an interrupted or long-running drag can never land its release as
     * a model selection. A generation token keeps re-arm / deferred-disarm
     * races across rapid successive drags safe.
     */
    const ClickGuard = {
      arm(doc) {
        let guard = doc.__dshMdsClickGuard;
        if (!guard) {
          guard = doc.__dshMdsClickGuard = {
            armed: false,
            token: 0,
            swallow(event) {
              event.stopPropagation();
              event.preventDefault();
            },
          };
        }
        guard.token++;
        if (guard.armed) return;
        guard.armed = true;
        doc.addEventListener('click', guard.swallow, true);
      },
      disarm(doc) {
        const guard = doc.__dshMdsClickGuard;
        if (!guard || !guard.armed) return;
        const token = guard.token;
        setTimeout(() => {
          if (!guard.armed || guard.token !== token) return; // re-armed for a newer drag
          guard.armed = false;
          doc.removeEventListener('click', guard.swallow, true);
        }, CONFIG.gesture.guardReleaseMs);
      },
    };

    // ============================================================== policies

    /** The unit a policy's build() assembles: everything the session mutates
     *  during one drag. The policy itself is NOT duplicated here — the session
     *  owns it once. */
    function makeUnit(el, container, viewport, siblings, event) {
      const rects = siblings.map((n) => n.getBoundingClientRect());
      const from = siblings.indexOf(el);
      return {
        el,                    // dragged element (row button / section)
        container,             // reorder parent (section / viewport)
        viewport,
        siblings,
        rects,
        from,
        to: from,
        startX: event.clientX, // gesture threshold baseline (press pointer)
        startY: event.clientY,
        anchorY: event.clientY, // follow anchor (grab pixel); re-derived with the rects pairing
        savedScroll: viewport ? viewport.scrollTop : 0,
      };
    }

    /**
     * DragPolicy: the rule set for one drag mode. Adding a future mode means
     * implementing this interface — the session, layout and replay never change.
     *   hitTest(target)         the draggable element under a press, or null
     *   build(el, event)        the drag unit, or null when not draggable
     *   collect(container)      the siblings in CURRENT flow order (structure
     *                           notifications re-anchor through this)
     *   followY(unit, y)        transform delta keeping the anchor under the pointer
     *   center(unit, y)         the dragged unit's visual center Y (slot detection)
     *   persist(host, unit)     write the finished order into storage
     *   draggingClass           CSS class while this unit is being dragged
     *   groupActiveClass        CSS class for the viewport during a group drag
     */
    const RowPolicy = {
      id: 'row',
      draggingClass: CLASS.dragging,
      groupActiveClass: null,
      hitTest(target) {
        const row = target.closest(CONTRACT.row);
        if (!row || !Dom.isModelRow(row)) return null;
        if (row.disabled || row.getAttribute('aria-disabled') === 'true') return null;
        return row;
      },
      build(el, event) {
        const container = el.closest(CONTRACT.section);
        if (!container) return null;
        const siblings = Dom.rowsOf(container);
        if (siblings.length < 2) return null;
        return makeUnit(el, container, Dom.findViewport(el), siblings, event);
      },
      collect(container) {
        return Dom.rowsOf(container);
      },
      followY(unit, pointerY) {
        const scrolled = Layout.scrolled(unit.viewport, unit.savedScroll);
        const origCenter = Layout.origCenter(unit.rects, unit.from);
        return pointerY - (origCenter - scrolled);
      },
      center(unit, pointerY) {
        return pointerY; // rows center under the pointer
      },
      persist(host, unit) {
        const rows = Dom.rowsOf(unit.container);
        host.state.order[Dom.sectionProvider(unit.container)] = rows.map(Dom.rowKey);
        Storage.save(CONFIG.storage.rowsKey, host.state.order);
      },
    };

    const GroupPolicy = {
      id: 'group',
      draggingClass: CLASS.groupDragging,
      groupActiveClass: CLASS.groupActive,
      hitTest(target) {
        return target.closest(CONTRACT.heading);
      },
      build(el, event) {
        const section = el.closest(CONTRACT.section);
        if (!section) return null;
        const viewport = Dom.findViewport(section);
        if (!viewport) return null;
        const siblings = Dom.sectionsOf(viewport);
        if (siblings.length < 2) return null;
        return makeUnit(section, viewport, viewport, siblings, event);
      },
      collect(container) {
        return Dom.sectionsOf(container);
      },
      followY(unit, pointerY) {
        const scrolled = Layout.scrolled(unit.viewport, unit.savedScroll);
        return (pointerY - unit.anchorY) + scrolled;
      },
      center(unit, pointerY) {
        // Grab point stays under the pointer, so the visual center simply moves
        // by the pointer delta; scroll shifts layout and transform equally.
        const origCenter = Layout.origCenter(unit.rects, unit.from);
        return origCenter + (pointerY - unit.anchorY);
      },
      persist(host, unit) {
        host.state.groups = Dom.sectionsOf(unit.viewport).map(Dom.sectionProvider);
        Storage.save(CONFIG.storage.groupsKey, host.state.groups);
      },
    };

    // ============================================================== sessions

    /**
     * Pointer state machine for one press:
     *   PRESSED  — down registered, threshold timer running
     *   READY    — long-press declared drag intent (hand + click guard)
     *   DRAGGING — threshold exceeded, transform following the pointer
     * Transitions:
     *   PRESSED/READY + move ≥ threshold → DRAGGING (via engage)
     *   PRESSED/READY + long-press       → READY
     *   DRAGGING      + up               → commit (persist + FLIP landing)
     *   DRAGGING      + cancel           → rollback (FLIP home)
     *   PRESSED/READY + up/cancel        → release (plain click or intent-only)
     * Structural notifications (host reflow / detach mid-drag) arrive through
     * onStructureChanged and resolve to re-anchor or a clean abort.
     */
    class Session {
      constructor(host, policy, el, event) {
        this.host = host;
        this.policy = policy;
        this.phase = Session.PRESSED;
        const unit = policy.build(el, event);
        if (!unit) throw new Error('session: unit build failed');
        this.unit = unit;
        this.pointerId = event.pointerId;
        this.lastPointerY = event.clientY;
        this.scrollFrame = null;
        this.scrollSpeed = 0;
        this.readyTimer = null;
        this.bounds = null;
        // Hand cursor for the whole press, everywhere inside the menu.
        if (unit.viewport) unit.viewport.classList.add(CLASS.pressing);
        this.armReadyTimer();
      }

      armReadyTimer() {
        this.readyTimer = setTimeout(() => {
          if (Host.active === this && this.phase === Session.PRESSED && !this.host.disposed) {
            this.phase = Session.READY;
            ClickGuard.arm(this.host.doc);
          }
        }, CONFIG.gesture.longPressMs);
      }

      onMove(event) {
        if (this.phase === Session.DRAGGING) {
          event.preventDefault();
          event.stopImmediatePropagation();
          this.update(event.clientY);
          return;
        }
        const dx = event.clientX - this.unit.startX;
        const dy = event.clientY - this.unit.startY;
        if (dx * dx + dy * dy < CONFIG.gesture.dragThresholdPx * CONFIG.gesture.dragThresholdPx) return;
        if (!this.engage()) return; // the ground left before the drag began
        event.preventDefault();
        event.stopImmediatePropagation();
        this.update(event.clientY);
      }

      /** Enter DRAGGING. False (already released) when the unit was detached
       *  between the press and the threshold — a press on vanishing ground. */
      engage() {
        if (!this.unit.el.isConnected || !this.unit.container.isConnected) {
          this.release();
          return false;
        }
        this.phase = Session.DRAGGING;
        this.clearReadyTimer();
        const doc = this.host.doc;
        ClickGuard.arm(doc);
        const unit = this.unit;
        // The session takes ownership of the layout: supersede every in-flight
        // landing FLIP on the set (bump its token, strip its inline styles) and
        // read the flow NOW — a rect snapshot must be the natural rest rect,
        // so a re-grabbed row mid-FLIP drags true instead of offset forever.
        for (const el of unit.siblings) {
          el.__dshMdsFlipToken = (el.__dshMdsFlipToken || 0) + 1;
          clearTransform(el);
        }
        this.refreshGeometry(this.policy.collect(unit.container));
        this.bounds = Layout.contentBounds(unit.viewport, unit.el);
        doc.documentElement.classList.add(CLASS.active);
        unit.el.classList.add(this.policy.draggingClass);
        if (this.policy.groupActiveClass && unit.viewport) {
          unit.viewport.classList.add(this.policy.groupActiveClass);
        }
        unit.el.style.willChange = 'transform';
        try { unit.el.setPointerCapture(this.pointerId); } catch (err) { /* best effort */ }
        return true;
      }

      clearReadyTimer() {
        clearTimeout(this.readyTimer);
        this.readyTimer = null;
      }

      /**
       * One structural notification from the host. Never polled: the observer
       * delivers this the moment the DOM actually changed. Resolve by phase:
       *   ground gone (unit/container detached or the unit left the list)
       *     → terminal: DRAGGING aborts, a pre-engage press releases
       *   flow changed while DRAGGING → re-anchor, the drag continues
       *   flow changed before engage    → refresh geometry only, so the drag
       *     (when the threshold is crossed) starts on live state
       */
      onStructureChanged() {
        const unit = this.unit;
        if (!unit.el.isConnected || !unit.container.isConnected) {
          this.resolveGroundGone();
          return;
        }
        const live = this.policy.collect(unit.container);
        if (!live.includes(unit.el)) {
          this.resolveGroundGone();
          return;
        }
        if (live.length !== unit.siblings.length ||
            live.some((el, i) => el !== unit.siblings[i])) {
          if (this.phase === Session.DRAGGING) this.reanchor(live);
          else this.refreshGeometry(live);
        }
      }

      /** The press/drag has no ground left: abort a live drag, release a press. */
      resolveGroundGone() {
        if (this.phase === Session.DRAGGING) this.structuralAbort();
        else this.release();
      }

      /**
       * Re-read the flow as one pairing rule: rest rects, the scrollTop they
       * were measured at, and the follow anchor are captured together — every
       * consumer (followY, center, slot midpoints) relies on that pairing. The
       * grabbed pixel within the unit (anchorY − rest top) is preserved across
       * the re-read, so the grab stays exactly under the pointer across both
       * a host reflow and any scrolling.
       */
      refreshGeometry(live) {
        const unit = this.unit;
        const grabOffset = unit.anchorY - unit.rects[unit.from].top;
        unit.siblings = live;
        unit.rects = live.map((el) => el.getBoundingClientRect());
        unit.from = live.indexOf(unit.el);
        unit.to = unit.from;
        unit.savedScroll = unit.viewport ? unit.viewport.scrollTop : 0;
        unit.anchorY = unit.rects[unit.from].top + grabOffset;
      }

      /** Pure pointer-driven geometry: follow, slot detection, make-way, autoscroll. */
      update(pointerY) {
        const unit = this.unit;
        const freeDy = this.policy.followY(unit, pointerY); // sign = direction from the original slot
        // The unit stops at the list boundary; the pointer keeps travelling,
        // slot detection runs on the unclamped pointer, so ordering semantics
        // are untouched.
        let dy = freeDy;
        if (this.bounds) dy = Math.min(this.bounds.max, Math.max(this.bounds.min, dy));
        unit.el.style.transform = `translate3d(0, ${dy}px, 0)`;
        this.lastPointerY = pointerY;

        const scrolled = Layout.scrolled(unit.viewport, unit.savedScroll);
        const center = this.policy.center(unit, pointerY);
        let to = unit.from;
        if (freeDy < 0) {
          while (to > 0 && center < Layout.mid(unit.rects, to - 1, scrolled)) to--;
        } else {
          while (to < unit.siblings.length - 1 && center > Layout.mid(unit.rects, to, scrolled)) to++;
        }
        if (to !== unit.to) {
          unit.to = to;
          this.paintSiblings();
        }

        if (unit.viewport) {
          this.scrollSpeed = AutoScroller.edgeSpeed(unit.viewport, pointerY);
          if (this.scrollSpeed !== 0) AutoScroller.start(this);
        }
      }

      paintSiblings() {
        const unit = this.unit;
        const shifts = Layout.shifts(unit.rects, unit.from, unit.to);
        for (let i = 0; i < unit.siblings.length; i++) {
          if (i === unit.from) continue;
          const el = unit.siblings[i];
          const shift = shifts[i];
          if ((el.__dshMdsShift || 0) === shift) continue;
          el.__dshMdsShift = shift;
          // Transition set together with the target transform animates from the
          // current computed position — 0→shift, shift→shift2 and shift→0 alike.
          el.style.transition = CONFIG.animation.siblingEase;
          el.style.transform = shift === 0 ? '' : `translate3d(0, ${shift}px, 0)`;
        }
      }

      /**
       * The host reflowed the list mid-drag: the same nodes now sit in a
       * different flow order. Re-anchor the session to that reality — clear
       * the stale make-way set, re-read the flow (the pairing rule preserves
       * the grabbed pixel), keep the follow displacement, and repaint make-way
       * for the new reality.
       */
      reanchor(live) {
        const unit = this.unit;
        const frozen = unit.el.style.transform; // keep the follow displacement
        this.clearSiblingMarks();              // stale make-way off the old set (incl. the unit)
        this.refreshGeometry(live);
        this.bounds = Layout.contentBounds(unit.viewport, unit.el); // fresh boundary
        unit.el.style.transform = frozen;
        unit.el.style.willChange = 'transform';
        this.update(this.lastPointerY); // repaint make-way for the new reality
      }

      /**
       * The ground left the drag (host detached the dragged unit or its
       * container): end the drag without reordering. Nothing is persisted.
       */
      structuralAbort() {
        this.teardown();
        this.clearSiblingMarks();
      }

      /**
       * The shared terminal sequence every ending runs: scrolling stops, the
       * gesture timer dies, press/drag marks and the page-level drag state
       * come off, the click guard disarms, the session marks itself ended and
       * deregisters from Host.active.
       */
      teardown() {
        AutoScroller.stop(this);
        this.clearReadyTimer();
        this.cleanupMarks();
        ClickGuard.disarm(this.host.doc);
        this.end();
      }

      /** Every terminal path deregisters itself: a finished session cannot
       *  occupy Host.active and silently block the next drag, and once ended
       *  it is inert — no later cleanup can re-enter its DRAGGING branch. */
      end() {
        this.clearReadyTimer();
        this.phase = Session.ENDED;
        if (Host.active === this) Host.active = null;
      }

      onUp(event) {
        if (this.phase === Session.DRAGGING) {
          event.preventDefault();
          event.stopImmediatePropagation();
          this.settle(true);
          return;
        }
        this.release(); // plain click or long-press release: guard handles intent
      }

      // pointercancel is platform-sourced and non-cancelable, and no click is
      // synthesized from it — no suppression needed, unlike onUp.
      onCancel() {
        if (this.phase === Session.DRAGGING) {
          this.settle(false);
          return;
        }
        this.release();
      }

      /** Landing: freeze visuals, reorder the DOM once, FLIP everything home. */
      settle(persist) {
        this.teardown();
        const unit = this.unit;
        const visuals = unit.siblings.map((el) => el.getBoundingClientRect());
        this.clearSiblingMarks(); // before the structural move: a throw past this point must not leave frozen inline transforms
        if (persist && unit.to !== unit.from) {
          const ref = unit.to > unit.from ? unit.siblings[unit.to].nextSibling : unit.siblings[unit.to];
          unit.container.insertBefore(unit.el, ref);
        }
        // FLIP anything whose frozen visual position differs from its new
        // natural position — covers the dragged element, displaced siblings,
        // and rows caught mid-animation.
        unit.siblings.forEach((el, i) => {
          flipToRest(el, visuals[i], i === unit.from ? CONFIG.animation.landEase : CONFIG.animation.siblingEase, CONFIG.animation.landSettleMs);
        });
        if (persist) {
          this.policy.persist(this.host, unit);
          if (this.host.onChange) this.host.onChange();
        }
      }

      /** Press ended without dragging: marks off, click guard released. */
      release() {
        this.teardown();
      }

      /** Press/drag visuals off; safe to call from any phase. Includes the
       *  page-level drag state (page cursor + selection lock), which is a
       *  drag visual too — one removal home for it. */
      cleanupMarks() {
        const unit = this.unit;
        if (unit.viewport) unit.viewport.classList.remove(CLASS.pressing);
        unit.el.classList.remove(this.policy.draggingClass);
        if (this.policy.groupActiveClass && unit.viewport) {
          unit.viewport.classList.remove(this.policy.groupActiveClass);
        }
        this.host.doc.documentElement.classList.remove(CLASS.active);
      }

      /** Make-way inline styles and per-element shift bookmarks off. */
      clearSiblingMarks() {
        for (const el of this.unit.siblings) {
          el.__dshMdsShift = 0;
          clearTransform(el);
        }
      }

      destroy() {
        const midDrag = this.phase === Session.DRAGGING; // before teardown marks it ended
        this.teardown();
        // Dispose may land mid-drag: strip inline styles so the menu doesn't
        // stay frozen — on detached or connected nodes alike.
        if (midDrag) this.clearSiblingMarks();
      }
    }

    Session.PRESSED = 1;
    Session.READY = 2;
    Session.DRAGGING = 3;
    Session.ENDED = 0;

    // ================================================================ replay

    /** Rank sentinel for items the saved order does not mention: keep current
     *  order after every ranked item, stable among themselves. */
    const UNRANKED_BASE = 1e9;

    /**
     * Re-applies the saved order to any open menu. One canonical implementation:
     *   1. group sections inside each viewport (GroupPolicy rank)
     *   2. rows inside each section (RowPolicy rank)
     * Runs synchronously inside the MutationObserver callback and, via the
     * scrollIntoView rule, between the host's menu mount and its native bookmark
     * scroll — after which the host's own positioning takes over.
     */
    const Replay = {
      sync(host) {
        if (Host.active) return false; // never fight an in-flight drag
        let changed = false;
        try {
          changed = this.all(host);
        } catch (err) { /* replay is best-effort; never break the host page */ }
        if (changed) {
          // The reorder moved the selected row — re-run the native bookmark so
          // it stays in view (host semantics: selected model visible on open).
          const selected = host.doc.querySelector(
            `${CONTRACT.section} ${CONTRACT.row}[aria-checked="true"]`);
          if (selected) selected.scrollIntoView({ block: 'nearest' });
        }
        return changed;
      },
      all(host) {
        let changed = false;
        const seen = new Set();
        for (const section of host.doc.querySelectorAll(CONTRACT.section)) {
          const viewport = section.parentElement;
          if (!viewport || seen.has(viewport)) continue;
          seen.add(viewport);
          if (this.applyViewport(host, viewport)) changed = true;
        }
        return changed;
      },
      /** Re-apply group + row order for one viewport. Idempotent. */
      applyViewport(host, viewport) {
        const sections = Dom.sectionsOf(viewport);
        if (sections.length === 0) return false;
        viewport.classList.add(CLASS.sortable);
        let changed = false;
        // 1) group order
        const groupRank = new Map(host.state.groups.map((p, i) => [p, i]));
        if (groupRank.size > 1) {
          changed = this.reorder(viewport, sections, (s) => groupRank.get(Dom.sectionProvider(s))) || changed;
        }
        // 2) row order inside each section
        for (const section of Dom.sectionsOf(viewport)) {
          const rows = Dom.rowsOf(section);
          if (rows.length < 2) continue;
          const wanted = host.state.order[Dom.sectionProvider(section)];
          if (!wanted || wanted.length === 0) continue;
          const rank = new Map(wanted.map((key, i) => [key, i]));
          changed = this.reorder(section, rows, (row) => {
            const key = Dom.rowKey(row);
            return key !== null && rank.has(key) ? rank.get(key) : undefined;
          }) || changed;
        }
        return changed;
      },
      reorder(container, items, rankOf) {
        const indexed = items.map((el, i) => {
          const at = rankOf(el);
          return { el, at: at === undefined || at === null ? UNRANKED_BASE + i : at };
        });
        for (let c = 1; c < indexed.length; c++) {
          if (indexed[c].at < indexed[c - 1].at) {
            indexed.sort((a, b) => a.at - b.at);
            for (const item of indexed) {
              clearTransform(item.el);
              container.appendChild(item.el);
            }
            return true;
          }
        }
        return false;
      },
    };

    // ================================================================== host

    /**
     * Per-install controller. Owns state, the style tag, the observers and the
     * pointer listeners; exactly one Host.active session may exist at a time.
     * `gate` is the single exception rule for session entry points (module
     * level — it needs nothing host-specific).
     */
    const Host = {
      active: null, // the one in-flight Session, if any

      /**
       * Any throw from a session entry point (pointer route, observer,
       * auto-scroll tick) ends the drag through the one abort path — marks
       * off, transforms off, Host.active released. No scattered try/catch
       * defenses, no zombie session can survive a throw.
       */
      gate(session, fn) {
        try {
          fn();
        } catch (err) {
          Host.abort(session);
        }
      },

      create(options) {
        const doc = options.document || global.document;
        const host = {
          doc,
          disposed: false,
          state: {
            order: Storage.load(CONFIG.storage.rowsKey, Storage.sanitizeRows),
            groups: Storage.load(CONFIG.storage.groupsKey, Storage.sanitizeGroups),
          },
          onChange: options.onChange,
        };

        // Style tag: dedupe by id so a double install cannot stack rules.
        const existing = doc.getElementById(CLASS.styleTagId);
        if (existing) existing.remove();
        const styleTag = doc.createElement('style');
        styleTag.id = CLASS.styleTagId;
        styleTag.textContent = CSS;
        doc.head.appendChild(styleTag);

        /**
         * One pointer route for all four events: bind the active session (if
         * the event belongs to it), dispatch, and leave termination to the
         * session — every terminal path deregisters itself.
         */
        host.onPointer = (event, method) => {
          const session = Host.active;
          if (!session || event.pointerId !== session.pointerId || host.disposed) return;
          Host.gate(session, () => session[method](event));
        };

        host.onPointerDown = (event) => {
          if (event.button !== 0 || host.disposed || Host.active) return;
          try {
            const target = event.target;
            if (!(target instanceof Element)) return;
            // Group drag: press on a group heading. preventDefault kills the
            // text-selection/native-drag gesture at the source (a real mouse
            // moving after mousedown on selectable text otherwise hands the
            // gesture to the browser, which stops pointer events entirely).
            const heading = GroupPolicy.hitTest(target);
            if (heading) {
              event.preventDefault();
              Host.begin(host, GroupPolicy, heading, event);
              return;
            }
            // Row drag: press on a model row.
            const row = RowPolicy.hitTest(target);
            if (row) Host.begin(host, RowPolicy, row, event);
          } catch (err) { /* never break the host page */ }
        };

        host.onPointerMove = (e) => host.onPointer(e, 'onMove');
        host.onPointerUp = (e) => host.onPointer(e, 'onUp');
        host.onPointerCancel = (e) => host.onPointer(e, 'onCancel');

        doc.addEventListener('pointerdown', host.onPointerDown, true);
        doc.addEventListener('pointermove', host.onPointerMove, true);
        doc.addEventListener('pointerup', host.onPointerUp, true);
        doc.addEventListener('pointercancel', host.onPointerCancel, true);

        Host.installScrollIntoViewRule(host);

        /**
         * The one structural channel. Host re-renders, catalog updates and
         * mid-drag reconciliations all surface here — as events, never polls.
         * Relevance gate first: a record whose target chain runs outside every
         * menu viewport (chat stream typing, status ticks, …) cannot have
         * touched the menu, so it never reaches the session or the replay.
         *   active session → onStructureChanged (re-anchor or clean abort)
         *   otherwise     → Replay.sync (menu opens in the saved order before
         *                   the browser paints it)
         */
        host.observer = new MutationObserver((records) => {
          if (host.disposed) return;
          if (!records.some(Dom.recordTouchesViewport)) return; // outside every menu: skip
          const session = Host.active;
          if (session) {
            Host.gate(session, () => session.onStructureChanged());
            return; // an in-flight session owns the menu; no replay behind its back
          }
          Replay.sync(host);
        });
        host.observer.observe(doc.body, { childList: true, subtree: true });

        Replay.sync(host); // first paint of any already-open menu
        return host;
      },

      /**
       * THE key integration rule: when the host scrolls a model row into view
       * (menu open / keyboard nav), reorder to the saved order FIRST, then let
       * the host's own native bookmark scroll land on the row at its new
       * position — our reorder is thus inserted between "shelve" and "bookmark"
       * with no race window (everything happens inside the host's synchronous
       * call).
       */
      installScrollIntoViewRule(host) {
        const elementProto = global.Element && global.Element.prototype;
        if (!elementProto || typeof elementProto.scrollIntoView !== 'function') return;
        host.prevScrollIntoView = elementProto.scrollIntoView;
        const prev = host.prevScrollIntoView;
        const patched = function (arg) {
          try {
            if (!host.disposed && !Host.active && Dom.isModelRow(this)) {
              const section = this.closest(CONTRACT.section);
              Replay.applyViewport(host, section.parentElement);
            }
          } catch (err) { /* fall through to the original */ }
          return prev.call(this, arg);
        };
        host.patchedScrollIntoView = patched;
        elementProto.scrollIntoView = patched;
      },

      begin(host, policy, el, event) {
        // A refused unit build (single row, no viewport, …) throws here and
        // lands in onPointerDown's page-safety catch — one layer of protection
        // per entry, not two.
        Host.active = new Session(host, policy, el, event);
      },

      /** The one abort path behind gate: clean the session off the page. */
      abort(session) {
        try {
          session.destroy();
        } catch (err) { /* ignore */ }
      },

      destroy(host) {
        if (host.disposed) return;
        host.disposed = true;
        if (Host.active) {
          Host.abort(Host.active);
          Host.active = null;
        }
        host.observer.disconnect();
        host.doc.removeEventListener('pointerdown', host.onPointerDown, true);
        host.doc.removeEventListener('pointermove', host.onPointerMove, true);
        host.doc.removeEventListener('pointerup', host.onPointerUp, true);
        host.doc.removeEventListener('pointercancel', host.onPointerCancel, true);
        const guard = host.doc.__dshMdsClickGuard;
        if (guard && guard.armed) {
          host.doc.removeEventListener('click', guard.swallow, true);
          guard.armed = false;
        }
        const elementProto = global.Element && global.Element.prototype;
        if (elementProto && host.patchedScrollIntoView &&
            elementProto.scrollIntoView === host.patchedScrollIntoView) {
          elementProto.scrollIntoView = host.prevScrollIntoView;
        }
        const styleTag = host.doc.getElementById(CLASS.styleTagId);
        if (styleTag) styleTag.remove();
        // The sortable mark Replay painted on viewports is an engine visual —
        // off with the rest of the install.
        for (const el of host.doc.querySelectorAll('.' + CLASS.sortable)) {
          el.classList.remove(CLASS.sortable);
        }
      },
    };

    // ================================================================ install

    function install(options) {
      options = options || {};
      const host = Host.create(options);
      return {
        dispose() {
          Host.destroy(host);
        },
        getOrder() {
          return {
            rows: JSON.parse(JSON.stringify(host.state.order)),
            groups: host.state.groups.slice(),
          };
        },
        clearOrder() {
          // Forget the saved order (storage + state). The DOM reverts to the
          // host's natural order at its next render; with nothing ranked,
          // Replay has nothing to apply — no re-sync needed here.
          host.state.order = {};
          host.state.groups = [];
          Storage.save(CONFIG.storage.rowsKey, host.state.order);
          Storage.save(CONFIG.storage.groupsKey, host.state.groups);
        },
      };
    }

    global.DshModelDragSort = {
      install,
      ROWS_KEY: CONFIG.storage.rowsKey,
      GROUPS_KEY: CONFIG.storage.groupsKey,
    };
  })(typeof window !== 'undefined' ? window : globalThis);
    const api = window.DshModelDragSort;
    if (!api) throw new Error('dsh-model-drag: engine failed to install');
    return {
      inject: [],
      apply(ctx) {
        const instance = api.install();
        if (ctx && typeof ctx.effect === 'function') {
          // ctx.effect runs its callback now; the RETURN value becomes the cleanup.
          ctx.effect(() => instance.dispose);
        }
      },
    };
  },
});
