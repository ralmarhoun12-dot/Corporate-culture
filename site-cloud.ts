import { supabase } from '@/integrations/supabase/client';
import type { Json } from '@/integrations/supabase/types';
import { assertStrongPassword, PASSWORD_HINT, passwordProblem } from './password-policy';
import { summarizeWork } from './review.functions';

function checked<T>(result: { data: T | null; error: { message: string } | null }): T {
  if (result.error) throw new Error(result.error.message);
  if (result.data === null) throw new Error('لم تصل البيانات');
  return result.data;
}

async function identity() {
  const { data, error } = await supabase.auth.getUser();
  if (error) throw error;
  const user = data.user;
  if (!user) throw new Error('سجّلي الدخول أولًا');
  return user;
}

export function installSiteCloud(onSignOut: () => void) {
  const api = {
    async login(email: string, password: string) {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      await identity();
      checked(await supabase.rpc('ensure_profile'));
      return api.load(true);
    },
    passwordHint: PASSWORD_HINT,
    passwordProblem,
    async summarize(text: string) {
      const { summary } = await summarizeWork({ data: { text } });
      return summary;
    },
    async register(name: string, username: string, email: string, password: string) {
      assertStrongPassword(password);
      const data = checked(await supabase.auth.signUp({ email, password, options: {
        data: { name, username }, emailRedirectTo: window.location.origin,
      } }));
      if (!data.session) return { confirmation: true };
      checked(await supabase.rpc('ensure_profile'));
      return api.load(true);
    },
    async load(login = false) {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) return null;
      const uid = auth.user.id;
      checked(await supabase.rpc('ensure_profile'));
      if (login) {
        const { error } = await supabase.from('profiles').update({ last_login: new Date().toISOString() }).eq('id', uid);
        if (error) throw error;
      }
      const roles = checked(await supabase.from('user_roles').select('role').eq('user_id', uid));
      const admin = roles.some(r => r.role === 'admin');
      const profiles = checked(await supabase.from('profiles').select('*'));
      const users = profiles.map(p => ({ fid: p.id, name: p.name, username: p.username, role: p.id === uid && admin ? 'admin' : 'teacher', ts: Date.parse(p.created_at), lastLogin: p.last_login ? Date.parse(p.last_login) : null, lastLogout: p.last_logout ? Date.parse(p.last_logout) : null }));
      const rows = [];
      for (let offset = 0; ; offset += 500) {
        const batch = checked(await supabase.from('entries').select('*').order('created_at').range(offset, offset + 499));
        rows.push(...batch);
        if (batch.length < 500) break;
      }
      const entries = await Promise.all(rows.map(async r => {
        const profile = users.find(p => p.fid === r.owner_id);
        const meta = r.meta && typeof r.meta === 'object' && !Array.isArray(r.meta) ? { ...r.meta } : {};
        if (Array.isArray(meta['atts'])) meta['atts'] = await Promise.all(meta['atts'].map(async a => {
          if (!a || typeof a !== 'object' || Array.isArray(a) || typeof a['path'] !== 'string') return a;
          const signed = checked(await supabase.storage.from('work-attachments').createSignedUrl(a['path'], 3600));
          return { ...a, data: signed.signedUrl };
        }));
        return { id: r.client_id, fid: r.id, type: r.type, name: profile?.name ?? 'مستخدمة', username: profile?.username ?? '', text: r.text, meta, ts: Date.parse(r.created_at) };
      }));
      const configResult = await supabase.from('site_config').select('*').eq('id', 'main').maybeSingle();
      if (configResult.error) throw configResult.error;
      const config = configResult.data;
      return { users, entries, session: users.find(p => p.fid === uid)?.username, uid, config, email: auth.user.email };
    },
    async save(entry: { id: string; type: string; text: string; meta: Record<string, Json> }) {
      const user = await identity();
      const meta = { ...entry.meta };
      const uploaded: string[] = [];
      try {
        if (Array.isArray(meta['atts'])) meta['atts'] = await Promise.all(meta['atts'].map(async a => {
          if (!a || typeof a !== 'object' || Array.isArray(a)) throw new Error('مرفق غير صالح');
          if (typeof a['path'] === 'string') { const { data: _data, ...rest } = a; return rest; }
          if (typeof a['data'] !== 'string' || !a['data'].startsWith('data:')) throw new Error('مرفق غير صالح');
          const blob = await fetch(a['data']).then(r => r.blob());
          const path = `${user.id}/${crypto.randomUUID()}`;
          checked(await supabase.storage.from('work-attachments').upload(path, blob, { contentType: blob.type }));
          uploaded.push(path);
          const { data: _data, ...rest } = a;
          return { ...rest, path };
        }));
        let clientId = entry.id;
        if (entry.type.startsWith('quiz_')) {
          const oldResult = await supabase.from('entries').select('client_id').eq('owner_id', user.id).eq('type', entry.type).maybeSingle();
          if (oldResult.error) throw oldResult.error;
          const old = oldResult.data;
          if (old) clientId = old.client_id;
        }
        return checked(await supabase.from('entries').upsert({ owner_id: user.id, client_id: clientId, type: entry.type, text: entry.text, meta }, { onConflict: 'owner_id,client_id' }).select('id,client_id').single());
      } catch (error) {
        if (uploaded.length) await supabase.storage.from('work-attachments').remove(uploaded);
        throw error;
      }
    },
    async remove(id: string) {
      await identity();
      const { error } = await supabase.from('entries').delete().eq('id', id);
      if (error) throw error;
    },
    async config(welcome: Json, videos: Json) {
      await identity();
      const { error } = await supabase.from('site_config').upsert({ id: 'main', welcome, videos });
      if (error) throw error;
    },
    async password(current_password: string, password: string) {
      if (!current_password) throw new Error('أدخلي كلمة المرور الحالية');
      assertStrongPassword(password);
      if (password === current_password) throw new Error('اختاري كلمة مرور مختلفة عن الحالية');
      const { error } = await supabase.auth.updateUser({ password, current_password });
      if (error) throw error;
    },
    async logout() {
      const user = await identity();
      const update = await supabase.from('profiles').update({ last_logout: new Date().toISOString() }).eq('id', user.id);
      if (update.error) throw update.error;
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
    },
    async forgot(email: string) {
      checked(await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}/reset-password` }));
    },
  };
  const target = window as Window & { ministryCloud?: typeof api };
  target.ministryCloud = api;
  const { data: listener } = supabase.auth.onAuthStateChange(event => {
    if (event === 'SIGNED_OUT') onSignOut();
  });
  return () => { listener.subscription.unsubscribe(); delete target.ministryCloud; };
}