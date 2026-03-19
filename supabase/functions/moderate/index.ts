// Supabase Edge Function: AI moderation for text and images
// Env: OPENAI_API_KEY (text), GOOGLE_VISION_API_KEY (images). If missing, that check is skipped (allowed).

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

type ModerationResult = { allowed: boolean; reason?: string }

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

async function moderateText(text: string): Promise<ModerationResult> {
  const apiKey = Deno.env.get('OPENAI_API_KEY')
  if (!apiKey?.trim()) return { allowed: true }

  const res = await fetch('https://api.openai.com/v1/moderations', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ input: text.slice(0, 20000) }),
  })
  if (!res.ok) {
    console.warn('OpenAI moderation API error:', res.status, await res.text())
    return { allowed: true }
  }
  const data = await res.json()
  const result = data.results?.[0]
  if (result?.flagged) {
    const categories = result.categories || {}
    const flagged = Object.entries(categories).filter(([, v]) => v === true).map(([k]) => k)
    return {
      allowed: false,
      reason: flagged.length ? `Message blocked (${flagged.join(', ')})` : 'Message not allowed by moderation.',
    }
  }
  return { allowed: true }
}

const LIKELY = 'LIKELY'
const VERY_LIKELY = 'VERY_LIKELY'

async function moderateImage(imageBase64: string): Promise<ModerationResult> {
  const apiKey = Deno.env.get('GOOGLE_VISION_API_KEY')
  if (!apiKey?.trim()) return { allowed: true }

  const res = await fetch(`https://vision.googleapis.com/v1/images:annotate?key=${encodeURIComponent(apiKey)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      requests: [
        {
          image: { content: imageBase64 },
          features: [{ type: 'SAFE_SEARCH_DETECTION' }],
        },
      ],
    }),
  })
  if (!res.ok) {
    console.warn('Vision API error:', res.status, await res.text())
    return { allowed: true }
  }
  const data = await res.json()
  const annotation = data.responses?.[0]?.safeSearchAnnotation
  if (!annotation) return { allowed: true }

  const adult = annotation.adult || 'UNKNOWN'
  const racy = annotation.racy || 'UNKNOWN'
  if (adult === LIKELY || adult === VERY_LIKELY) {
    return { allowed: false, reason: 'Image not allowed (explicit content detected).' }
  }
  if (racy === VERY_LIKELY) {
    return { allowed: false, reason: 'Image not allowed (inappropriate content).' }
  }
  return { allowed: true }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: corsHeaders })
  }
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405)
  }

  try {
    const body = await req.json()
    const type = body?.type
    if (type === 'text') {
      const text = typeof body.text === 'string' ? body.text : ''
      const result = await moderateText(text)
      return jsonResponse(result)
    }
    if (type === 'image') {
      const base64 = typeof body.image_base64 === 'string' ? body.image_base64 : ''
      if (!base64) return jsonResponse({ allowed: true })
      const result = await moderateImage(base64)
      return jsonResponse(result)
    }
    return jsonResponse({ allowed: true })
  } catch (err) {
    console.error('Moderate function error:', err)
    return jsonResponse({ allowed: true })
  }
})
