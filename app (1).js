let devices = [];
let config = { areas: ["EXPORT", "MALA PACZKA", "ROZBIOR"], types: ["terminal", "drukarka", "komputer", "bizerba", "inne"] };
let statuses = {};
let currentPage = 1;
let expandedDevices = new Set();

const body = document.querySelector("#devicesBody");
const searchInput = document.querySelector("#searchInput");
const typeFilter = document.querySelector("#typeFilter");
const areaFilter = document.querySelector("#areaFilter");
const sortSelect = document.querySelector("#sortSelect");
const toggleAdvancedButton = document.querySelector("#toggleAdvancedButton");
const advancedPanel = document.querySelector("#advancedPanel");
const statusFilter = document.querySelector("#statusFilter");
const addressModeFilter = document.querySelector("#addressModeFilter");
const keywordFilter = document.querySelector("#keywordFilter");
const clearFiltersButton = document.querySelector("#clearFiltersButton");
const summary = document.querySelector("#summary");
const pingAllButton = document.querySelector("#pingAllButton");
const openAddButton = document.querySelector("#openAddButton");
const saveButton = document.querySelector("#saveButton");
const forgetPasswordButton = document.querySelector("#forgetPasswordButton");
const editorPanel = document.querySelector("#editorPanel");
const editorTitle = document.querySelector("#editorTitle");
const closeEditorButton = document.querySelector("#closeEditorButton");
const deviceForm = document.querySelector("#deviceForm");
const editName = document.querySelector("#editName");
const deviceName = document.querySelector("#deviceName");
const deviceIp = document.querySelector("#deviceIp");
const deviceAddressMode = document.querySelector("#deviceAddressMode");
const deviceType = document.querySelector("#deviceType");
const deviceArea = document.querySelector("#deviceArea");
const deviceKeywords = document.querySelector("#deviceKeywords");
const deviceNote = document.querySelector("#deviceNote");
const numeratorField = document.querySelector("#numeratorField");
const deviceNumerator = document.querySelector("#deviceNumerator");
const deleteEditButton = document.querySelector("#deleteEditButton");
const clearFormButton = document.querySelector("#clearFormButton");
const editHint = document.querySelector("#editHint");
const namePingInput = document.querySelector("#namePingInput");
const namePingButton = document.querySelector("#namePingButton");
const namePingResult = document.querySelector("#namePingResult");
const newTypeInput = document.querySelector("#newTypeInput");
const addTypeButton = document.querySelector("#addTypeButton");
const typeChips = document.querySelector("#typeChips");
const newAreaInput = document.querySelector("#newAreaInput");
const addAreaButton = document.querySelector("#addAreaButton");
const areaChips = document.querySelector("#areaChips");
const pageSizeSelect = document.querySelector("#pageSizeSelect");
const prevPageButton = document.querySelector("#prevPageButton");
const nextPageButton = document.querySelector("#nextPageButton");
const pageInfo = document.querySelector("#pageInfo");
const themeToggleButton = document.querySelector("#themeToggleButton");
const sshUserInput = document.querySelector("#sshUserInput");
const vncLocalPortInput = document.querySelector("#vncLocalPortInput");
const vncRemotePortInput = document.querySelector("#vncRemotePortInput");
const saveTunnelSettingsButton = document.querySelector("#saveTunnelSettingsButton");

let resolvedIpCache = {};
try {
  resolvedIpCache = JSON.parse(localStorage.getItem("dhcpResolvedIps") || "{}");
} catch (error) {
  resolvedIpCache = {};
}

function saveResolvedIpCache() {
  try {
    localStorage.setItem("dhcpResolvedIps", JSON.stringify(resolvedIpCache));
  } catch (error) {
    /* ignore storage errors (np. tryb prywatny) */
  }
}

function rememberResolvedIp(name, resolvedIp) {
  if (!resolvedIp || resolvedIpCache[name] === resolvedIp) {
    return;
  }
  resolvedIpCache[name] = resolvedIp;
  saveResolvedIpCache();
}

function pingTargetFor(device) {
  return device.addressMode === "dhcp" ? device.name : (device.ip || device.name);
}

function applyTheme(theme) {
  document.documentElement.classList.toggle("theme-dark", theme === "dark");
  if (themeToggleButton) {
    themeToggleButton.textContent = theme === "dark" ? "☀️" : "🌙";
    themeToggleButton.title = theme === "dark" ? "Przełącz na jasny motyw" : "Przełącz na ciemny motyw";
  }
}

function initTheme() {
  let saved = null;
  try {
    saved = localStorage.getItem("devicePanelTheme");
  } catch (error) {
    saved = null;
  }
  const theme = saved || (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  applyTheme(theme);
}

if (themeToggleButton) {
  themeToggleButton.addEventListener("click", () => {
    const isDark = document.documentElement.classList.contains("theme-dark");
    const nextTheme = isDark ? "light" : "dark";
    applyTheme(nextTheme);
    try {
      localStorage.setItem("devicePanelTheme", nextTheme);
    } catch (error) {
      /* ignore storage errors */
    }
  });
}

initTheme();

const passwordModal = document.querySelector("#passwordModal");
const passwordForm = document.querySelector("#passwordForm");
const passwordModalInput = document.querySelector("#passwordModalInput");
const passwordModalCancel = document.querySelector("#passwordModalCancel");

function getStoredPassword() {
  try {
    return sessionStorage.getItem("devicePanelAdminPassword") || "";
  } catch (error) {
    return "";
  }
}

function storePassword(value) {
  try {
    sessionStorage.setItem("devicePanelAdminPassword", value);
  } catch (error) {
    /* ignore storage errors */
  }
}

function clearStoredPassword() {
  try {
    sessionStorage.removeItem("devicePanelAdminPassword");
  } catch (error) {
    /* ignore storage errors */
  }
}

let passwordPromiseResolve = null;

function closePasswordModal() {
  passwordModal.classList.add("hidden");
  passwordModalInput.value = "";
}

function requestPasswordFromModal() {
  return new Promise((resolve) => {
    passwordPromiseResolve = resolve;
    passwordModal.classList.remove("hidden");
    passwordModalInput.focus();
  });
}

passwordForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const value = passwordModalInput.value;
  closePasswordModal();
  if (passwordPromiseResolve) {
    if (value) {
      storePassword(value);
    }
    passwordPromiseResolve(value || null);
    passwordPromiseResolve = null;
  }
});

passwordModalCancel.addEventListener("click", () => {
  closePasswordModal();
  if (passwordPromiseResolve) {
    passwordPromiseResolve(null);
    passwordPromiseResolve = null;
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !passwordModal.classList.contains("hidden")) {
    closePasswordModal();
    if (passwordPromiseResolve) {
      passwordPromiseResolve(null);
      passwordPromiseResolve = null;
    }
  }
});

async function getAdminPassword() {
  const stored = getStoredPassword();
  if (stored) {
    return stored;
  }
  return requestPasswordFromModal();
}

forgetPasswordButton.addEventListener("click", () => {
  clearStoredPassword();
  editHint.textContent = "Hasło wyczyszczone — przy następnym zapisie zostanie zapytane ponownie.";
});

async function loadDevices() {
  const [devicesResponse, configResponse] = await Promise.all([
    fetch("/api/devices"),
    fetch("/api/config"),
  ]);
  devices = await devicesResponse.json();
  config = await configResponse.json();
  sshUserInput.value = config.sshUser || "";
  vncLocalPortInput.value = config.vncLocalPort || 5900;
  vncRemotePortInput.value = config.vncRemotePort || 5900;
  fillFilters();
  fillFormOptions();
  renderDictionaries();
  render();
}

function uniq(values) {
  return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b, "pl"));
}

function fillFilters() {
  const types = uniq([...config.types, ...devices.map((device) => device.type)]);
  const areas = uniq([...config.areas, ...devices.map((device) => device.area)]);

  typeFilter.innerHTML = '<option value="">Wszystkie typy</option>' +
    types.map((type) => `<option value="${escapeHtml(type)}">${escapeHtml(type)}</option>`).join("");

  areaFilter.innerHTML = '<option value="">Wszystkie obszary</option>' +
    areas.map((area) => `<option value="${escapeHtml(area)}">${escapeHtml(area)}</option>`).join("");
}

function fillFormOptions() {
  const types = uniq([...config.types, ...devices.map((device) => device.type)]);
  const areas = uniq([...config.areas, ...devices.map((device) => device.area)]);

  deviceType.innerHTML = types.map((type) => `<option value="${escapeHtml(type)}">${escapeHtml(type)}</option>`).join("");
  deviceArea.innerHTML = areas.map((area) => `<option value="${escapeHtml(area)}">${escapeHtml(area)}</option>`).join("");
}

function getFilteredDevices() {
  const query = searchInput.value.trim().toLowerCase();
  const type = typeFilter.value;
  const area = areaFilter.value;
  const status = statusFilter.value;
  const addressMode = addressModeFilter.value;
  const keyword = keywordFilter.value.trim().toLowerCase();

  const filtered = devices.filter((device) => {
    const currentStatus = statuses[device.name]?.online === true ? "online" : statuses[device.name]?.online === false ? "offline" : "unknown";
    const keywords = device.keywords || [];
    const haystack = [
      device.name,
      device.ip,
      device.addressMode,
      device.type,
      device.site,
      device.area,
      device.areaCode,
      device.number,
      device.note,
      resolvedIpCache[device.name] || "",
      ...(device.keywords || []),
    ].join(" ").toLowerCase();

    return (!query || haystack.includes(query)) &&
      (!type || device.type === type) &&
      (!area || device.area === area) &&
      (!status || currentStatus === status) &&
      (!addressMode || device.addressMode === addressMode) &&
      (!keyword || keywords.some((word) => word.toLowerCase().includes(keyword)));
  });

  return sortDevices(filtered);
}

function sortDevices(items) {
  const key = sortSelect.value;
  const statusRank = { online: 0, offline: 1, unknown: 2 };

  return [...items].sort((a, b) => {
    if (key === "status") {
      const statusA = statuses[a.name]?.online === true ? "online" : statuses[a.name]?.online === false ? "offline" : "unknown";
      const statusB = statuses[b.name]?.online === true ? "online" : statuses[b.name]?.online === false ? "offline" : "unknown";
      return statusRank[statusA] - statusRank[statusB] || compareText(a.name, b.name);
    }

    return compareText(a[key] || "", b[key] || "") || compareText(a.name, b.name);
  });
}

function compareText(a, b) {
  return String(a).localeCompare(String(b), "pl", { numeric: true, sensitivity: "base" });
}

function render() {
  const filtered = getFilteredDevices();
  const pageData = paginate(filtered);
  const online = filtered.filter((device) => statuses[device.name]?.online === true).length;
  const offline = filtered.filter((device) => statuses[device.name]?.online === false).length;

  summary.innerHTML = [
    metric(filtered.length, "Widoczne urządzenia"),
    metric(online, "Online"),
    metric(offline, "Offline"),
    metric(devices.length, "Wszystkie w pliku"),
  ].join("");

  pingAllButton.textContent = `Ping widoczne (${filtered.length})`;
  body.innerHTML = pageData.items.map((device) => row(device)).join("");
  renderPagination(pageData, filtered.length);
}

function metric(value, label) {
  return `<div class="metric"><strong>${value}</strong><span>${label}</span></div>`;
}

function paginate(items) {
  const selectedSize = pageSizeSelect.value;
  if (selectedSize === "all") {
    currentPage = 1;
    return { items, page: 1, totalPages: 1, pageSize: items.length || 1 };
  }

  const pageSize = Number(selectedSize);
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  currentPage = Math.min(Math.max(1, currentPage), totalPages);
  const start = (currentPage - 1) * pageSize;
  return {
    items: items.slice(start, start + pageSize),
    page: currentPage,
    totalPages,
    pageSize,
  };
}

function renderPagination(pageData, totalItems) {
  const selectedSize = pageSizeSelect.value;
  const showingAll = selectedSize === "all";
  const from = totalItems === 0 ? 0 : (pageData.page - 1) * pageData.pageSize + 1;
  const to = showingAll ? totalItems : Math.min(totalItems, pageData.page * pageData.pageSize);

  pageInfo.textContent = `${from}-${to} z ${totalItems} | strona ${pageData.page} / ${pageData.totalPages}`;
  prevPageButton.disabled = showingAll || pageData.page <= 1;
  nextPageButton.disabled = showingAll || pageData.page >= pageData.totalPages;
}

function resetPageAndRender() {
  currentPage = 1;
  render();
}

function row(device) {
  const status = statuses[device.name] || {};
  const statusClass = status.checking ? "checking" : status.online === true ? "online" : status.online === false ? "offline" : "";
  const statusText = status.checking ? "Sprawdzam" : status.online === true ? `Online${status.latencyMs ? ` ${status.latencyMs} ms` : ""}` : status.online === false ? "Offline" : "Nieznany";
  const target = pingTargetFor(device);
  const knownDhcpIp = status.resolvedIp || resolvedIpCache[device.name];
  const ipText = device.ip || (knownDhcpIp ? `${knownDhcpIp} (DHCP)` : "DHCP / po nazwie");
  const modeText = device.addressMode === "static" ? "Stałe IP" : "DHCP";
  const expanded = expandedDevices.has(device.name);

  const mainRow = `
    <tr class="deviceRow" data-toggle="${escapeHtml(device.name)}">
      <td>
        <span class="expandArrow ${expanded ? "open" : ""}">▸</span>
        <span class="status ${statusClass}"><span class="dot"></span></span>
        <strong>${escapeHtml(device.name)}</strong>
      </td>
      <td><code>${escapeHtml(ipText)}</code></td>
      <td>${escapeHtml(device.area || "")}</td>
      <td class="rowActions">
        <button data-ping-target="${escapeHtml(target)}" data-ping-name="${escapeHtml(device.name)}">Ping</button>
        ${device.type === "terminal" ? `<button data-ssh="${escapeHtml(device.name)}" title="Otwórz tunel SSH do VNC">Tunel SSH</button>` : ""}
        <button data-edit="${escapeHtml(device.name)}">Edytuj</button>
      </td>
    </tr>
  `;

  if (!expanded) {
    return mainRow;
  }

  const detailFields = [
    ["Status", statusText],
    ["Typ", device.type || "inne"],
    ["Adresowanie", modeText],
  ];

  if (device.type === "bizerba") {
    detailFields.push(["Numerator", device.numerator || ""]);
  }

  detailFields.push(["Notatka", device.note || ""]);

  const keywordsHtml = (device.keywords || []).map((word) => `<span class="tag">${escapeHtml(word)}</span>`).join("") || "<span class=\"muted\">brak</span>";

  const detailRow = `
    <tr class="deviceDetail">
      <td colspan="4">
        <div class="detailGrid">
          ${detailFields.map(([label, value]) => `
            <div class="detailItem">
              <span class="detailLabel">${escapeHtml(label)}</span>
              <span class="detailValue">${escapeHtml(value || "—")}</span>
            </div>
          `).join("")}
          <div class="detailItem detailKeywords">
            <span class="detailLabel">Słowa kluczowe</span>
            <span class="detailValue">${keywordsHtml}</span>
          </div>
        </div>
      </td>
    </tr>
  `;

  return mainRow + detailRow;
}

async function pingDevice(device) {
  const target = pingTargetFor(device);
  statuses[device.name] = { checking: true };
  render();

  try {
    const response = await fetch(`/api/ping?target=${encodeURIComponent(target)}`);
    statuses[device.name] = await response.json();
    if (statuses[device.name].resolvedIp) {
      rememberResolvedIp(device.name, statuses[device.name].resolvedIp);
    }
  } catch (error) {
    statuses[device.name] = { online: false, error: error.message };
  }

  render();
}

async function pingTarget(target, name) {
  const device = devices.find((item) => item.name === name);
  const effectiveTarget = device ? pingTargetFor(device) : target;
  statuses[name] = { checking: true };
  render();

  try {
    const response = await fetch(`/api/ping?target=${encodeURIComponent(effectiveTarget)}`);
    statuses[name] = await response.json();
    if (statuses[name].resolvedIp) {
      rememberResolvedIp(name, statuses[name].resolvedIp);
    }
  } catch (error) {
    statuses[name] = { online: false, error: error.message };
  }

  render();
}

async function startSshTunnel(name) {
  const password = await getAdminPassword();
  if (!password) {
    return;
  }

  const response = await fetch("/api/ssh-tunnel", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Admin-Password": password,
    },
    body: JSON.stringify({ name }),
  });
  const result = await response.json();

  if (!response.ok) {
    if (response.status === 403) {
      clearStoredPassword();
    }
    alert(result.error || "Nie udało się uruchomić tunelu SSH.");
    return;
  }

  alert(result.message || "Uruchomiono SSH.");
}

async function saveTunnelSettings() {
  const password = await getAdminPassword();
  if (!password) {
    return;
  }

  const updatedConfig = {
    ...config,
    sshUser: sshUserInput.value.trim(),
    vncLocalPort: Number(vncLocalPortInput.value) || 5900,
    vncRemotePort: Number(vncRemotePortInput.value) || 5900,
  };

  const response = await fetch("/api/config", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Admin-Password": password,
    },
    body: JSON.stringify({ config: updatedConfig }),
  });
  const result = await response.json();

  if (!response.ok) {
    if (response.status === 403) {
      clearStoredPassword();
    }
    alert(result.error || "Nie udało się zapisać ustawień tunelu.");
    return;
  }

  config = { ...config, ...result.config };
  sshUserInput.value = config.sshUser || "";
  vncLocalPortInput.value = config.vncLocalPort || 5900;
  vncRemotePortInput.value = config.vncRemotePort || 5900;
  alert("Zapisano ustawienia tunelu SSH.");
}

async function pingByName() {
  const name = namePingInput.value.trim();
  if (!name) {
    namePingResult.textContent = "Wpisz nazwę urządzenia.";
    return;
  }

  namePingResult.textContent = "Sprawdzam...";
  const response = await fetch(`/api/ping-name?name=${encodeURIComponent(name)}`);
  const result = await response.json();

  if (!response.ok) {
    namePingResult.textContent = result.error || "Nie udało się sprawdzić urządzenia.";
    return;
  }

  statuses[result.device.name] = {
    online: result.online,
    latencyMs: result.latencyMs,
    resolvedIp: result.resolvedIp,
  };
  if (result.resolvedIp) {
    rememberResolvedIp(result.device.name, result.resolvedIp);
  }
  const shownIp = result.device.ip || result.resolvedIp || resolvedIpCache[result.device.name] || "brak IP w pliku";
  namePingResult.textContent = `${result.device.name}: ${shownIp}, ${result.online ? "online" : "offline"}.`;
  render();
}

async function pingAll() {
  const filtered = getFilteredDevices();
  if (filtered.length === 0) {
    alert("Brak urządzeń w aktualnym wyszukiwaniu.");
    return;
  }

  for (const device of filtered) {
    await pingDevice(device);
  }
}

function readFormDevice() {
  const device = {
    name: deviceName.value.trim().toUpperCase(),
    ip: deviceIp.value.trim(),
    addressMode: deviceAddressMode.value,
    type: deviceType.value,
    area: deviceArea.value,
    keywords: deviceKeywords.value.split(",").map((word) => word.trim()).filter(Boolean),
    note: deviceNote.value.trim(),
  };

  if (device.type === "bizerba") {
    device.numerator = deviceNumerator.value.trim();
  }

  return device;
}

function submitForm(event) {
  event.preventDefault();
  const newDevice = readFormDevice();
  const oldName = editName.value;
  const duplicate = devices.some((device) => device.name === newDevice.name && device.name !== oldName);

  if (duplicate) {
    alert("Urządzenie o takiej nazwie już istnieje.");
    return;
  }

  if (newDevice.addressMode === "static" && !newDevice.ip) {
    alert("Stałe IP wymaga wpisania adresu IP.");
    deviceIp.focus();
    return;
  }

  const wasNew = !oldName;

  if (oldName) {
    devices = devices.map((device) => device.name === oldName ? newDevice : device);
  } else {
    devices = [...devices, newDevice];
  }

  fillFilters();
  fillFormOptions();
  render();

  if (wasNew) {
    const keepArea = newDevice.area;
    clearForm();
    deviceArea.value = keepArea;
    editHint.textContent = `Dodano ${newDevice.name}. Kliknij "Zapisz zmiany", aby zapisać plik.`;
    deviceName.focus();
  } else {
    editName.value = newDevice.name;
    deleteEditButton.classList.remove("hidden");
    editorTitle.textContent = `Edytuj ${newDevice.name}`;
    editHint.textContent = `Zmieniono ${newDevice.name}. Kliknij "Zapisz zmiany", aby zapisać plik.`;
  }
}

function openEditor(mode = "add") {
  editorPanel.classList.remove("collapsed");
  if (mode === "add") {
    clearForm();
    editorTitle.textContent = "Dodaj urządzenie";
    deviceName.focus();
  }
}

function closeEditor() {
  editorPanel.classList.add("collapsed");
}

function editDevice(name) {
  const device = devices.find((item) => item.name === name);
  if (!device) {
    return;
  }

  editName.value = device.name;
  deviceName.value = device.name;
  deviceIp.value = device.ip;
  deviceAddressMode.value = device.addressMode || (device.type === "bizerba" ? "static" : "dhcp");
  deviceType.value = device.type || "inne";
  deviceArea.value = device.area || config.areas[0] || "";
  deviceKeywords.value = (device.keywords || []).join(", ");
  deviceNote.value = device.note || "";
  deviceNumerator.value = device.numerator || "";
  toggleNumeratorField();
  editorTitle.textContent = `Edytuj ${device.name}`;
  editHint.textContent = `Edytujesz ${device.name}. Zapis do pliku wymaga hasła.`;
  deleteEditButton.classList.remove("hidden");
  editorPanel.classList.remove("collapsed");
  deviceName.focus();
}

function deleteEditedDevice() {
  const name = editName.value;
  if (!name) {
    alert("Najpierw wybierz urządzenie do edycji.");
    return;
  }

  if (!confirm(`Usunąć ${name}?`)) {
    return;
  }

  devices = devices.filter((device) => device.name !== name);
  clearForm();
  saveDevices();
}

async function saveDevices() {
  const password = await getAdminPassword();
  if (!password) {
    return;
  }

  const response = await fetch("/api/devices", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Admin-Password": password,
    },
    body: JSON.stringify({ devices }),
  });
  const result = await response.json();

  if (!response.ok) {
    if (response.status === 403) {
      clearStoredPassword();
    }
    alert(result.error || "Nie udało się zapisać.");
    return;
  }

  const configResponse = await fetch("/api/config", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Admin-Password": password,
    },
    body: JSON.stringify({ config }),
  });
  const configResult = await configResponse.json();
  if (!configResponse.ok) {
    if (configResponse.status === 403) {
      clearStoredPassword();
    }
    alert(configResult.error || "Urządzenia zapisane, ale nie udało się zapisać typów i obszarów.");
    return;
  }

  await loadDevices();
  alert(`Zapisano ${result.count} urządzeń oraz typy i obszary.`);
}

function clearForm() {
  editName.value = "";
  deviceForm.reset();
  deviceAddressMode.value = "dhcp";
  deviceType.value = config.types[0] || "inne";
  deviceArea.value = config.areas[0] || "";
  editorTitle.textContent = "Dodaj urządzenie";
  deleteEditButton.classList.add("hidden");
  editHint.textContent = "";
  toggleNumeratorField();
}

function renderDictionaries() {
  typeChips.innerHTML = config.types.map((type) => dictionaryChip(type, "type")).join("");
  areaChips.innerHTML = config.areas.map((area) => dictionaryChip(area, "area")).join("");
}

function dictionaryChip(value, kind) {
  return `<span class="dictChip">${escapeHtml(value)} <button type="button" data-remove-${kind}="${escapeHtml(value)}">×</button></span>`;
}

function addDictionaryValue(kind) {
  const input = kind === "type" ? newTypeInput : newAreaInput;
  const value = input.value.trim();
  if (!value) {
    return;
  }

  const key = kind === "type" ? "types" : "areas";
  config[key] = uniq([...config[key], value]);
  input.value = "";
  fillFilters();
  fillFormOptions();
  renderDictionaries();
  render();
}

function removeDictionaryValue(kind, value) {
  const key = kind === "type" ? "types" : "areas";
  const inUse = devices.some((device) => kind === "type" ? device.type === value : device.area === value);
  if (inUse) {
    alert("Nie można usunąć pozycji używanej przez urządzenia.");
    return;
  }

  config[key] = config[key].filter((item) => item !== value);
  fillFilters();
  fillFormOptions();
  renderDictionaries();
  render();
}

function clearFilters() {
  searchInput.value = "";
  typeFilter.value = "";
  areaFilter.value = "";
  statusFilter.value = "";
  addressModeFilter.value = "";
  keywordFilter.value = "";
  sortSelect.value = "name";
  fillFilters();
  resetPageAndRender();
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

document.addEventListener("click", (event) => {
  const toggleRow = event.target.closest(".deviceRow");
  if (toggleRow && !event.target.closest(".rowActions")) {
    const name = toggleRow.dataset.toggle;
    if (expandedDevices.has(name)) {
      expandedDevices.delete(name);
    } else {
      expandedDevices.add(name);
    }
    render();
  }

  const pingTargetValue = event.target.dataset.pingTarget;
  const pingNameValue = event.target.dataset.pingName;
  const editNameValue = event.target.dataset.edit;
  const sshValue = event.target.dataset.ssh;
  const removeTypeValue = event.target.dataset.removeType;
  const removeAreaValue = event.target.dataset.removeArea;

  if (pingTargetValue && pingNameValue) {
    pingTarget(pingTargetValue, pingNameValue);
  }

  if (editNameValue) {
    editDevice(editNameValue);
  }

  if (sshValue) {
    startSshTunnel(sshValue);
  }

  if (removeTypeValue) {
    removeDictionaryValue("type", removeTypeValue);
  }

  if (removeAreaValue) {
    removeDictionaryValue("area", removeAreaValue);
  }
});

searchInput.addEventListener("input", resetPageAndRender);
typeFilter.addEventListener("change", resetPageAndRender);
sortSelect.addEventListener("change", resetPageAndRender);
statusFilter.addEventListener("change", resetPageAndRender);
addressModeFilter.addEventListener("change", resetPageAndRender);
keywordFilter.addEventListener("input", resetPageAndRender);
toggleAdvancedButton.addEventListener("click", () => advancedPanel.classList.toggle("collapsed"));
clearFiltersButton.addEventListener("click", clearFilters);
areaFilter.addEventListener("change", () => {
  resetPageAndRender();
});
pageSizeSelect.addEventListener("change", resetPageAndRender);
prevPageButton.addEventListener("click", () => {
  currentPage -= 1;
  render();
});
nextPageButton.addEventListener("click", () => {
  currentPage += 1;
  render();
});
deviceForm.addEventListener("submit", submitForm);
openAddButton.addEventListener("click", () => openEditor("add"));
closeEditorButton.addEventListener("click", closeEditor);
deleteEditButton.addEventListener("click", deleteEditedDevice);
clearFormButton.addEventListener("click", clearForm);
pingAllButton.addEventListener("click", pingAll);
saveButton.addEventListener("click", saveDevices);
addTypeButton.addEventListener("click", () => addDictionaryValue("type"));
addAreaButton.addEventListener("click", () => addDictionaryValue("area"));
newTypeInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    addDictionaryValue("type");
  }
});
newAreaInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    addDictionaryValue("area");
  }
});
deviceType.addEventListener("change", () => {
  if (deviceType.value === "bizerba") {
    deviceAddressMode.value = "static";
  }
  toggleNumeratorField();
});

function toggleNumeratorField() {
  const isBizerba = deviceType.value === "bizerba";
  numeratorField.classList.toggle("hidden", !isBizerba);
  if (!isBizerba) {
    deviceNumerator.value = "";
  }
}
namePingButton.addEventListener("click", pingByName);
saveTunnelSettingsButton.addEventListener("click", saveTunnelSettings);
namePingInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    pingByName();
  }
});

loadDevices();
