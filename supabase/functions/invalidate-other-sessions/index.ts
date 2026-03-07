// Supabase Edge Function: Invalida tutte le altre sessioni dell'utente
// Chiamata dal client dopo il login per disconnettere le vecchie sessioni

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // Ottieni il token JWT dal client
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Missing authorization header' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Crea client Supabase con service role (per accedere all'Admin API)
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false
        }
      }
    )

    // Verifica il token del client e ottieni l'user ID
    const token = authHeader.replace('Bearer ', '')
    const { data: { user }, error: userError } = await supabaseAdmin.auth.getUser(token)
    
    if (userError || !user) {
      return new Response(
        JSON.stringify({ error: 'Invalid token' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Ottieni tutte le sessioni attive dell'utente dall'Admin API
    const { data: sessions, error: sessionsError } = await supabaseAdmin.auth.admin.listUserSessions(user.id)
    
    if (sessionsError) {
      console.error('Error listing sessions:', sessionsError)
      return new Response(
        JSON.stringify({ error: 'Failed to list sessions' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Invalida tutte le sessioni tranne quella corrente (identificata dal token)
    const currentSessionId = sessions?.find(s => s.access_token === token)?.id
    let invalidatedCount = 0

    if (sessions && sessions.length > 0) {
      for (const session of sessions) {
        // Non invalidare la sessione corrente
        if (session.id === currentSessionId) continue
        
        // Invalida la sessione usando l'Admin API
        const { error: invalidateError } = await supabaseAdmin.auth.admin.signOut(session.id, 'global')
        
        if (!invalidateError) {
          invalidatedCount++
        } else {
          console.error(`Error invalidating session ${session.id}:`, invalidateError)
        }
      }
    }

    return new Response(
      JSON.stringify({ 
        success: true, 
        invalidated: invalidatedCount,
        total: sessions?.length || 0
      }),
      { 
        status: 200, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    )

  } catch (error) {
    console.error('Edge function error:', error)
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
