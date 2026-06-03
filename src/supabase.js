import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = 'https://vafdxhneykqervstkkew.supabase.co'
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZhZmR4aG5leWtxZXJ2c3Rra2N3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA1MDgxODQsImV4cCI6MjA5NjA4NDE4NH0.Y-p9a22T94SMo4IfRjeV0CyeiNxmw5fTu1LNPzZkJho'

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
