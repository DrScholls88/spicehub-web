import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

serve(async () => {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )
  const { error } = await supabase.rpc('keepalive_ping', {})
  if (error) {
    // Fallback: raw query
    const { error: rawErr } = await supabase.from('home_groups').select('id').limit(0)
    if (rawErr) {
      return new Response(JSON.stringify({ ok: false, error: rawErr.message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      })
    }
  }
  return new Response(JSON.stringify({ ok: true, ts: new Date().toISOString() }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
})
