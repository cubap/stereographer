export function parseRegionString(value) {
  if (!value || typeof value !== "string") return null

  const parts = value.split(",").map(Number)
  if (parts.length !== 4 || parts.some(part => !Number.isFinite(part) || part < 0)) return null

  return {
    x: parts[0],
    y: parts[1],
    w: parts[2],
    h: parts[3]
  }
}

export function parseHashRegions(hash) {
  if (!hash) return null

  const params = new URLSearchParams(hash.replace(/^#/, ""))
  const left = parseRegionString(params.get("left"))
  const right = parseRegionString(params.get("right"))

  if (!left || !right) return null
  return { left, right }
}

export function buildCenteredRegions(imageWidth, imageHeight) {
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

export function resolveImageSource(resource) {
  if (!resource || typeof resource !== "object") return null

  const type = getIiifType(resource)

  if (type === "Image") {
    return {
      id: getIiifId(resource),
      format: resource.format,
      width: resource.width,
      height: resource.height,
      service: normalizeService(resource.service)
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
      format: body.format,
      width: body.width,
      height: body.height,
      service: normalizeService(body.service)
    }
  }

  if (type === "SpecificResource" && body.source) {
    return resolveBodyToImage(body.source)
  }

  return null
}

function normalizeService(service) {
  if (!service) return null
  if (Array.isArray(service)) return service[0]
  return service
}

export function decodeIiifContentIfNeeded(raw) {
  const maybeUrl = safeUrl(raw)
  if (maybeUrl) {
    const parsed = new URL(maybeUrl)
    const embedded = parsed.searchParams.get("iiif-content")
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

export function isLikelyImageUrl(value) {
  const parsed = safeUrl(value)
  if (!parsed) return false
  return /\.(avif|bmp|gif|jpe?g|jp2|png|tiff?|webp)(?:$|[?#])/i.test(parsed)
}

export function safeUrl(value) {
  try {
    return new URL(value).toString()
  } catch {
    return null
  }
}

export function tryDecodeBase64Url(value) {
  try {
    const normalized = value.replace(/-/g, "+").replace(/_/g, "/")
    const padded = normalized + "===".slice((normalized.length + 3) % 4)
    return atob(padded)
  } catch {
    return null
  }
}

export function toBase64Url(text) {
  const b64 = btoa(text)
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

export function tryParseJson(text) {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

export function getIiifType(value) {
  const rawType = value?.type ?? value?.["@type"] ?? null
  if (!rawType) return null
  return rawType.includes(":") ? rawType.split(":").pop() : rawType
}

export function getIiifId(value) {
  return value?.id ?? value?.["@id"] ?? null
}

export function loadImageDimensions(url) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = "anonymous"
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight })
    img.onerror = () => reject(new Error("Image could not be loaded"))
    img.src = url
  })
}

export async function fetchJson(url) {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`)
  }

  return response.json()
}
