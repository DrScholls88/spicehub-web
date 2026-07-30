import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// In-memory rate limit (resets on cold start — acceptable for free tier)
const attempts = new Map<string, { count: number; resetAt: number }>()
const MAX_ATTEMPTS = 10
const WINDOW_MS = 60 * 60 * 1000 // 1 hour

function checkRateLimit(key: string): boolean {
  const now = Date.now()
  const entry = attempts.get(key)
  if (!entry || now > entry.resetAt) {
    attempts.set(key, { count: 1, resetAt: now + WINDOW_MS })
    return true
  }
  if (entry.count >= MAX_ATTEMPTS) return false
  entry.count++
  return true
}

serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 })
  }

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } },
  )

  const { data: { user }, error: authErr } = await supabase.auth.getUser()
  if (authErr || !user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })
  }

  // Rate limit by user ID
  if (!checkRateLimit(user.id)) {
    return new Response(
      JSON.stringify({ error: 'Too many attempts. Try again later.' }),
      { status: 429 },
    )
  }

  const { invite_code, display_name, avatar } = await req.json()
  const code = (invite_code || '').toUpperCase().trim()

  if (!code || code.length !== 6) {
    return new Response(
      JSON.stringify({ error: 'Invalid or expired code' }),
      { status: 400 },
    )
  }

  // Use service role for group lookup (bypasses RLS)
  const serviceClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  const { data: group, error: groupErr } = await serviceClient
    .from('home_groups')
    .select('id, name, invite_code_expires')
    .eq('invite_code', code)
    .maybeSingle()

  if (groupErr || !group) {
    return new Response(
      JSON.stringify({ error: 'Invalid or expired code' }),
      { status: 400 },
    )
  }

  // Check expiry
  if (group.invite_code_expires && new Date(group.invite_code_expires) < new Date()) {
    return new Response(
      JSON.stringify({ error: 'Invalid or expired code' }),
      { status: 400 },
    )
  }

  // Check if already a member
  const { data: existing } = await serviceClient
    .from('home_group_members')
    .select('user_id')
    .eq('home_group_id', group.id)
    .eq('user_id', user.id)
    .maybeSingle()

  if (existing) {
    return new Response(
      JSON.stringify({ error: 'Already a member', home_group_id: group.id, name: group.name }),
      { status: 409 },
    )
  }

  // Insert membership
  const { error: insertErr } = await serviceClient
    .from('home_group_members')
    .insert({
      home_group_id: group.id,
      user_id: user.id,
      display_name: display_name || 'Partner',
      avatar: avatar || null,
      role: 'member',
    })

  if (insertErr) {
    return new Response(
      JSON.stringify({ error: 'Failed to join group' }),
      { status: 500 },
    )
  }

  // Increment invite_code_uses
  await serviceClient
    .from('home_groups')
    .update({ invite_code_uses: (group as any).invite_code_uses + 1 })
    .eq('id', group.id)

  return new Response(
    JSON.stringify({ home_group_id: group.id, name: group.name }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  )
})
