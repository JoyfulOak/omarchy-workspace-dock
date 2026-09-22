// Pure dock-entry builder and pin-order helpers.

function movePin(list, entryId, target) {
  var out = []
  for (var i = 0; i < (list ? list.length : 0); i++) {
    if (list[i] !== entryId) out.push(list[i])
  }
  if (target < 0) target = 0
  else if (target > out.length) target = out.length
  out.splice(target, 0, entryId)
  return out
}

function pinIndexAt(inX, inY, barSize, spacing, dockLength, pinnedLength, vertical) {
  var advance = barSize + spacing
  var offset = vertical ? inY : inX
  var idx = Math.round((offset - barSize / 2) / advance)
  idx = Math.max(0, Math.min(idx, dockLength))
  idx = Math.min(idx, pinnedLength)
  return idx
}

function dropGapIndex(target, dragCurrent, pinnedLength) {
  var gap = target <= dragCurrent ? target : target + 1
  return Math.max(0, Math.min(gap, pinnedLength))
}

function dropOffset(gap, barSize, spacing, barPad) {
  var advance = barSize + spacing
  if (gap === 0) return 0
  return gap * advance - (spacing + barPad) / 2
}

function previewCardTitle(entry, prettyName) {
  if (!entry) return ""
  var ws = entry.windows || (entry.toplevel ? [entry.toplevel] : [])
  if (ws.length <= 1) return String(entry.toplevel ? (entry.toplevel.title || "Window") : "")
  var name = prettyName || ""
  return name ? (name + " — " + ws.length + " windows") : (ws.length + " windows")
}

function previewStillValid(previewEntry, entries) {
  if (!previewEntry || !previewEntry.windows || !entries) return false
  var placed = {}
  for (var s = 0; s < entries.length; s++) {
    var wins = entries[s].windows || []
    for (var w = 0; w < wins.length; w++) {
      var addr = optsAddress(wins[w])
      if (addr) placed[addr] = true
    }
  }
  for (var pd = 0; pd < previewEntry.windows.length; pd++) {
    var paddr = optsAddress(previewEntry.windows[pd])
    if (paddr && placed[paddr]) return true
  }
  return false
}

function optsAddress(toplevel) {
  if (!toplevel || !toplevel.address) return ""
  var address = String(toplevel.address)
  return address.indexOf("0x") === 0 ? address : "0x" + address
}

function workspaceSortId(entry) {
  var windows = entry && entry.windows ? entry.windows : []
  var best = 2147483647
  for (var i = 0; i < windows.length; i++) {
    var ws = windows[i] && windows[i].workspace
    var id = ws ? Number(ws.id) : NaN
    if (isFinite(id) && id > 0 && id < best) best = id
  }
  return best
}

function workspaceGroupKey(toplevel) {
  var id = workspaceSortId({ windows: [toplevel] })
  return id === 2147483647 ? "special" : String(id)
}

// The bar owns one continuous rail: every workspace control is followed by
// the running groups assigned to it. Keep `entries` app-only so pin matching,
// menus, and drag persistence retain their existing identities.
function buildWorkspaceRail(entries, workspaceIds) {
  var ids = workspaceIds ? workspaceIds.slice() : [1, 2, 3, 4, 5]
  var rail = []
  var placed = {}
  for (var i = 0; i < ids.length; i++) {
    var id = Number(ids[i])
    if (!isFinite(id) || id <= 0 || placed[id]) continue
    placed[id] = true
    rail.push({ kind: "workspace", workspaceId: id })
    var hasApps = false
    for (var j = 0; j < entries.length; j++) {
      var entry = entries[j]
      if (entry.kind === "pinned") continue
      if (workspaceSortId(entry) === id) {
        rail.push(entry)
        hasApps = true
      }
    }
    // Keep the dock's visual group boundary, but only after a workspace that
    // actually has app icons. Empty adjacent workspaces remain plain numbers.
    if (hasApps && i + 1 < ids.length) rail.push({ kind: "separator", workspaceId: id })
  }
  // Special/minimized groups do not belong to a numbered workspace. Retain
  // them, followed by unlaunched pins in their saved order.
  for (var k = 0; k < entries.length; k++) {
    var other = entries[k]
    if (other.kind !== "pinned" && !placed[workspaceSortId(other)]) rail.push(other)
  }
  for (var p = 0; p < entries.length; p++) {
    if (entries[p].kind === "pinned") rail.push(entries[p])
  }
  return rail
}

// opts: {
//   dragOrder,
//   isRelevantWindow(w),
//   pinMatchesWindow(pid, w),
//   desktopEntry(w),
//   entryForId(pid),
//   windowPinId(w),
//   normalizedAddress(w),
//   isPseudo(w)
// }
function buildEntries(windows, pinned, opts) {
  var entries = []
  var placed = {}
  var order = opts.dragOrder !== null && opts.dragOrder !== undefined ? opts.dragOrder : pinned
  for (var i = 0; i < order.length; i++) {
    var pid = order[i]
    var group = []
    for (var w = 0; w < windows.length; w++) {
      var addr2 = opts.normalizedAddress(windows[w])
      if (!addr2 || placed[addr2] || !opts.isRelevantWindow(windows[w])) continue
      if (opts.pinMatchesWindow(pid, windows[w])) group.push(windows[w])
    }
    if (group.length > 0) {
      var byWorkspace = []
      for (var gi = 0; gi < group.length; gi++) {
        var workspaceKey = workspaceGroupKey(group[gi])
        var workspaceGroup = null
        for (var wi = 0; wi < byWorkspace.length; wi++) {
          if (byWorkspace[wi].key === workspaceKey) { workspaceGroup = byWorkspace[wi]; break }
        }
        if (!workspaceGroup) {
          workspaceGroup = { key: workspaceKey, windows: [] }
          byWorkspace.push(workspaceGroup)
        }
        workspaceGroup.windows.push(group[gi])
      }
      byWorkspace.sort(function(a, b) {
        var aw = workspaceSortId({ windows: a.windows })
        var bw = workspaceSortId({ windows: b.windows })
        return aw - bw
      })
      for (var bg = 0; bg < byWorkspace.length; bg++) {
        var workspaceWindows = byWorkspace[bg].windows
        var groupEntry = null
        for (var ge = 0; ge < workspaceWindows.length; ge++) {
          var candidateEntry = opts.desktopEntry(workspaceWindows[ge])
          if (candidateEntry && candidateEntry.id) { groupEntry = candidateEntry; break }
        }
        entries.push({
          kind: "window",
          pinId: pid,
          appKey: pid + "@" + byWorkspace[bg].key,
          toplevel: workspaceWindows[0],
          windows: workspaceWindows,
          entry: groupEntry || opts.entryForId(pid)
        })
      }
      for (var pa = 0; pa < group.length; pa++) placed[opts.normalizedAddress(group[pa])] = true
    } else {
      entries.push({ kind: "pinned", pinId: pid, entryId: pid, entry: opts.entryForId(pid), toplevel: null })
    }
  }
  var tailGroups = []
  for (var j = 0; j < windows.length; j++) {
    var jaddr = opts.normalizedAddress(windows[j])
    if (!jaddr || placed[jaddr] || !opts.isRelevantWindow(windows[j])) continue
    var appKey = opts.windowPinId(windows[j])
    var workspaceKey = workspaceGroupKey(windows[j])
    var groupKey = appKey + "@" + workspaceKey
    var bi = -1
    for (var k = 0; k < tailGroups.length; k++) {
      if (tailGroups[k].key === groupKey) { bi = k; break }
    }
    if (bi === -1) {
      tailGroups.push({ key: groupKey, appKey: appKey, entry: opts.desktopEntry(windows[j]), windows: [windows[j]] })
    } else {
      tailGroups[bi].windows.push(windows[j])
    }
    placed[jaddr] = true
  }
  for (var t = 0; t < tailGroups.length; t++) {
    tailGroups[t].order = t
  }
  tailGroups.sort(function(a, b) {
    var aw = workspaceSortId({ windows: a.windows })
    var bw = workspaceSortId({ windows: b.windows })
    return aw === bw ? a.order - b.order : aw - bw
  })
  for (var t = 0; t < tailGroups.length; t++) {
    entries.push({
      kind: "window",
      pinId: "",
      appKey: tailGroups[t].appKey,
      toplevel: tailGroups[t].windows[0],
      windows: tailGroups[t].windows,
      entry: tailGroups[t].entry
    })
  }
  var sig = ""
  for (var s = 0; s < entries.length; s++) {
    var e = entries[s]
    if (e.kind === "pinned") { sig += "p:" + e.entryId + ";"; continue }
    sig += (e.pinId ? "P" : "T") + ":" + e.appKey + ":"
    for (var sa = 0; sa < e.windows.length; sa++) {
      var swa = opts.normalizedAddress(e.windows[sa])
      sig += "w:" + swa
      if (opts.isPseudo(e.windows[sa])) {
        sig += "s:" + ((e.windows[sa].workspace && e.windows[sa].workspace.name) || "")
      }
      sig += ","
    }
    sig += ";"
  }
  return { entries: entries, sig: sig }
}
