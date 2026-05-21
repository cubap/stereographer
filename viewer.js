const openEditorLinkEl = document.getElementById("openEditorLink")
const viewportEl = document.getElementById("viewerViewport")
const overlayEl = document.getElementById("viewerOverlay")
const overlayTextEl = document.getElementById("viewerOverlayText")
const spinnerEl = document.getElementById("viewerSpinner")
const stageEl = document.getElementById("viewerStage")
const leftEl = document.getElementById("viewerLeft")
const rightEl = document.getElementById("viewerRight")

const speedEl = document.getElementById("viewerSpeed")
const speedValueEl = document.getElementById("viewerSpeedValue")
const toggleEl = document.getElementById("viewerToggle")
const zoomEl = document.getElementById("viewerZoom")
const resetViewBtnEl = document.getElementById("resetViewBtn")

const state = {
  image: null,
  left: null,
  right: null,
  baseScale: 1,
  zoom: 1,
  panX: 0,
  panY: 0,
  drag: null,
  flickerOn: false,
  flickerTimer: null,
  rightVisible: true
}

init()

async function init() {
  updateEditorLink()
  bindControls()

  const iiifContent = new URLSearchParams(window.location.search).get("iiif-content")
  if (!iiifContent) {
    setStatus("Missing iiif-content in URL. Add ?iiif-content=... from the editor link.", true)
    return
  }

  try {
    setStatus("Loading IIIF resource...")
    const resolved = decodeIiifContentIfNeeded(iiifContent)
    const resource = await fetchJson(resolved)
    const image = resolveImageSource(resource)

    if (!image?.id) {
      throw new Error("Could not resolve an image source")
    }

    const dims = await loadImageDimensions(image.id)
    state.image = {
      ...image,
      width: image.width ?? dims.width,
      height: image.height ?? dims.height
    }

    const hashRegions = parseHashRegions(window.location.hash)
    if (hashRegions) {
      state.left = hashRegions.left
      state.right = hashRegions.right
    } else {
      const centered = buildCenteredRegions(state.image.width, state.image.height)
      state.left = centered.left
      state.right = centered.right
    }

    applyRegions()
    setStatus("Loaded. Drag to pan, wheel/slider to zoom, use Play Flicker to alternate.")
  } catch (err) {
    setStatus(`Load failed: ${err.message}`, true)
  }
}

function bindControls() {
  speedEl.addEventListener("input", () => {
    speedValueEl.value = speedEl.value
    restartFlickerIfNeeded()
  })

  toggleEl.addEventListener("click", toggleFlicker)

  zoomEl.addEventListener("input", () => {
    state.zoom = Number(zoomEl.value) / 100
    syncStageTransform()
  })

  resetViewBtnEl.addEventListener("click", resetView)
  window.addEventListener("resize", resetView)

  viewportEl.addEventListener("wheel", handleWheelZoom, { passive: false })
  viewportEl.addEventListener("pointerdown", beginPan)
  viewportEl.addEventListener("pointermove", handlePan)
  viewportEl.addEventListener("pointerup", endPan)
  viewportEl.addEventListener("pointercancel", endPan)

  document.addEventListener("keydown", event => {
    if (event.code !== "Space") return
    if (document.activeElement?.tagName === "INPUT" || document.activeElement?.tagName === "TEXTAREA") return
    event.preventDefault()
    toggleFlicker()
  })
}

function applyRegions() {
  if (!state.image || !state.left || !state.right) return

  stageEl.style.setProperty("--ratio", `${state.left.w} / ${state.left.h}`)
  requestAnimationFrame(() => {
    applyLayerCrop(leftEl, state.left)
    applyLayerCrop(rightEl, state.right)
    resetView()
  })
}

function applyLayerCrop(layerEl, region) {
  const imageWidth = state.image.width
  const imageHeight = state.image.height
  const stageRect = stageEl.getBoundingClientRect()
  const stageWidth = stageRect.width || stageEl.clientWidth || 1
  const stageHeight = stageRect.height || stageEl.clientHeight || 1
  const scaleX = stageWidth / region.w
  const scaleY = stageHeight / region.h

  layerEl.style.backgroundImage = `url("${state.image.id}")`
  layerEl.style.backgroundSize = `${imageWidth * scaleX}px ${imageHeight * scaleY}px`
  layerEl.style.backgroundPosition = `${-region.x * scaleX}px ${-region.y * scaleY}px`
}

function resetView() {
  state.baseScale = computeContainScale()
  state.zoom = 1
  state.panX = 0
  state.panY = 0
  zoomEl.value = "100"
  syncStageTransform()
}

function computeContainScale() {
  stageEl.style.transform = "translate(0px, 0px) scale(1)"
  const viewportRect = viewportEl.getBoundingClientRect()
  const stageRect = stageEl.getBoundingClientRect()

  if (!viewportRect.width || !viewportRect.height || !stageRect.width || !stageRect.height) return 1

  const fitScale = Math.min(viewportRect.width / stageRect.width, viewportRect.height / stageRect.height)
  return clamp(fitScale, 0.1, 1)
}

function stepZoom(delta) {
  const next = clamp(state.zoom + delta, 0.5, 4)
  state.zoom = next
  zoomEl.value = String(Math.round(next * 100))
  syncStageTransform()
}

function handleWheelZoom(event) {
  event.preventDefault()
  const delta = event.deltaY < 0 ? 0.08 : -0.08
  stepZoom(delta)
}

function beginPan(event) {
  if (event.button !== 0) return
  viewportEl.classList.add("dragging")
  state.drag = {
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    startPanX: state.panX,
    startPanY: state.panY
  }
  viewportEl.setPointerCapture(event.pointerId)
}

function handlePan(event) {
  if (!state.drag || event.pointerId !== state.drag.pointerId) return

  state.panX = state.drag.startPanX + (event.clientX - state.drag.startX)
  state.panY = state.drag.startPanY + (event.clientY - state.drag.startY)
  syncStageTransform()
}

function endPan(event) {
  if (!state.drag || event.pointerId !== state.drag.pointerId) return

  viewportEl.classList.remove("dragging")
  state.drag = null
}

function syncStageTransform() {
  const scale = state.baseScale * state.zoom
  stageEl.style.transform = `translate(${Math.round(state.panX)}px, ${Math.round(state.panY)}px) scale(${scale})`
}

function toggleFlicker() {
  state.flickerOn = !state.flickerOn
  toggleEl.setAttribute("aria-pressed", String(state.flickerOn))
  toggleEl.innerHTML = state.flickerOn ? "&#9208;" : "&#9654;"

  if (!state.flickerOn) {
    stopFlicker()
    rightEl.style.visibility = "visible"
    return
  }

  startFlicker()
}

function restartFlickerIfNeeded() {
  if (!state.flickerOn) return
  startFlicker()
}

function startFlicker() {
  stopFlicker()
  state.rightVisible = true

  const interval = Number(speedEl.value)
  state.flickerTimer = setInterval(() => {
    state.rightVisible = !state.rightVisible
    rightEl.style.visibility = state.rightVisible ? "visible" : "hidden"
  }, interval)
}

function stopFlicker() {
  if (!state.flickerTimer) return
  clearInterval(state.flickerTimer)
  state.flickerTimer = null
}

function parseHashRegions(hash) {
  if (!hash) return null

  const params = new URLSearchParams(hash.replace(/^#/, ""))
  const left = parseRegionString(params.get("left"))
  const right = parseRegionString(params.get("right"))

  if (!left || !right) return null
  return { left, right }
}

function parseRegionString(value) {
  if (!value) return null
  const parts = value.split(",").map(Number)
  if (parts.length !== 4 || parts.some(Number.isNaN)) return null

  return {
    x: parts[0],
    y: parts[1],
    w: parts[2],
    h: parts[3]
  }
}

function buildCenteredRegions(imageWidth, imageHeight) {
  const paddingPct = 10
  const width = Math.max(48, Math.floor((imageWidth / 100 * (100 - paddingPct * 3)) / 2))
  const height = Math.max(48, Math.floor(imageHeight / 100 * (100 - paddingPct * 2)))
  const y = Math.floor(paddingPct * imageHeight / 100)
  const leftX = Math.floor(paddingPct * imageWidth / 100)
  const rightX = leftX + width + Math.floor(paddingPct * imageWidth / 100)

  return {
    left: { x: leftX, y, w: width, h: height },
    right: { x: rightX, y, w: width, h: height }
  }
}

function resolveImageSource(resource) {
  if (!resource || typeof resource !== "object") return null

  const type = getIiifType(resource)

  if (type === "Image") {
    return {
      id: getIiifId(resource),
      width: resource.width,
      height: resource.height
    }
  }

  if (type === "Canvas") {
    const anno = resource.items?.[0]?.items?.[0] ?? resource.images?.[0]
    return resolveBodyToImage(anno?.body ?? anno?.resource)
  }

  if (type === "Manifest") {
    const canvas = resource.items?.[0] ?? resource.sequences?.[0]?.canvases?.[0]
    if (!canvas) return null
    return resolveImageSource(canvas)
  }

  return null
}

function resolveBodyToImage(body) {
  if (!body) return null

  const type = getIiifType(body)
  if (type === "Image") {
    return {
      id: getIiifId(body),
      width: body.width,
      height: body.height
    }
  }

  if (type === "SpecificResource") {
    if (body.selector?.region && body.source) {
      return resolveBodyToImage(body.source)
    }
  }

  return null
}

function decodeIiifContentIfNeeded(raw) {
  const maybeUrl = safeUrl(raw)
  if (maybeUrl) {
    const p = new URL(maybeUrl)
    const embedded = p.searchParams.get("iiif-content")
    if (embedded) {
      const decoded = tryDecodeBase64Url(embedded)
      if (decoded) {
        const maybe = tryParseJson(decoded)
        if (maybe?.id) return maybe.id
      }
      return embedded
    }
    return raw
  }

  const decoded = tryDecodeBase64Url(raw)
  if (decoded) {
    const maybe = tryParseJson(decoded)
    if (maybe?.id) return maybe.id
  }

  return raw
}

function safeUrl(value) {
  try {
    return new URL(value).toString()
  } catch {
    return null
  }
}

function tryDecodeBase64Url(value) {
  try {
    const normalized = value.replace(/-/g, "+").replace(/_/g, "/")
    const padded = normalized + "===".slice((normalized.length + 3) % 4)
    return atob(padded)
  } catch {
    return null
  }
}

function tryParseJson(text) {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

function getIiifType(value) {
  const rawType = value?.type ?? value?.["@type"] ?? null
  if (!rawType) return null
  return rawType.includes(":") ? rawType.split(":").pop() : rawType
}

function getIiifId(value) {
  return value?.id ?? value?.["@id"] ?? null
}

function loadImageDimensions(url) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = "anonymous"
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight })
    img.onerror = () => reject(new Error("Image could not be loaded"))
    img.src = url
  })
}

async function fetchJson(url) {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`)
  }
  return response.json()
}

function updateEditorLink() {
  const suffix = `${window.location.search}${window.location.hash}`
  openEditorLinkEl.href = `./index.html${suffix}`
}

function setStatus(message, isError = false) {
  if (!overlayEl || !overlayTextEl || !spinnerEl) return

  if (!isError && message.toLowerCase().startsWith("loaded")) {
    overlayEl.hidden = true
    overlayEl.classList.remove("is-error")
    spinnerEl.hidden = true
    return
  }

  overlayEl.hidden = false
  overlayEl.classList.toggle("is-error", isError)
  overlayTextEl.textContent = message
  spinnerEl.hidden = isError
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max)
}
