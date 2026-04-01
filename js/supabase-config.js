/* ===== SUPABASE CONFIG ===== */
var SUPABASE_URL     = 'https://kfmciyqpraetjengmdxj.supabase.co';
var SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtmbWNpeXFwcmFldGplbmdtZHhqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ0Nzc2NjQsImV4cCI6MjA5MDA1MzY2NH0.F7fbONX_WHbkx5xQP49Z9sDDeQnYQYp7Gcmy6JveHQM';

// The CDN exposes the library as window.supabase — grab it before we overwrite
var _supabaseLib = window.supabase;

// Create the client and expose it globally as `supabase`
var supabase = _supabaseLib.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    realtime: { params: { eventsPerSecond: 10 } }
});

window.supabase = supabase;
console.log('Supabase client ready:', !!supabase);
