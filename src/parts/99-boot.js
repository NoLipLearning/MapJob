// Boot: run feature parts (each registered with PARTS.push), then start the core.
PARTS.forEach(fn => { try { fn(app); } catch (e) { console.error("[part]", e); } });
homeChip(); syncWeights(); $("sethome").textContent = home ? "Move my home" : "Set my home";
init(); refresh();
if (glOK && !home) { hint.hidden = false; hint.textContent = "Set your home to rank commutes from where you live"; setTimeout(() => { if (!setMode) hint.hidden = true; }, 7000); }