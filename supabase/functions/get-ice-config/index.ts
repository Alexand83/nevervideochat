// Supabase Edge Function: restituisce la configurazione ICE (STUN + TURN)
// Le credenziali TURN sono lette dagli env vars del progetto Supabase —
// NON sono mai esposte nel bundle JS del frontend.
//
// Env vars richiesti (impostabili in Supabase Dashboard → Settings → Edge Functions):
//   TURN_USERNAME   — username per il server TURN
//   TURN_CREDENTIAL — password per il server TURN
//   TURN_HOST       — hostname TURN (default: openrelay.metered.ca)

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
}

const STUN_ONLY: object[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun.cloudflare.com:3478' },
]

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: corsHeaders })
  }

  // Richiede almeno la presenza dell'apikey (Supabase anon key) per evitare
  // che l'endpoint sia chiamabile da chiunque senza alcun contesto dell'app.
  const apikey = req.headers.get('apikey') || req.headers.get('x-client-info')
  if (!apikey) {
    return new Response(JSON.stringify({ error: 'Missing apikey header' }), {
      status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const turnUser = Deno.env.get('TURN_USERNAME') ?? ''
  const turnCred = Deno.env.get('TURN_CREDENTIAL') ?? ''
  const turnHost = Deno.env.get('TURN_HOST') ?? 'openrelay.metered.ca'

  const iceServers: object[] = [...STUN_ONLY]

  if (turnUser && turnCred) {
    iceServers.push(
      { urls: `turn:${turnHost}:80`,                   username: turnUser, credential: turnCred },
      { urls: `turn:${turnHost}:443`,                  username: turnUser, credential: turnCred },
      { urls: `turn:${turnHost}:443?transport=tcp`,    username: turnUser, credential: turnCred },
      { urls: `turns:${turnHost}:443?transport=tcp`,   username: turnUser, credential: turnCred },
    )
  }

  const config = {
    iceServers,
    iceCandidatePoolSize: 10,
    bundlePolicy: 'max-bundle',
    rtcpMuxPolicy: 'require',
  }

  return new Response(JSON.stringify(config), {
    status: 200,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
      // Cache lato client 1 ora — le credenziali TURN di openrelay non scadono prima
      'Cache-Control': 'private, max-age=3600',
    },
  })
})
