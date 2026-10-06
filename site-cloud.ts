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

// ذاكرة مؤقتة للروابط الموقّعة: كانت تُولَّد من جديد لكل مرفق كل ١٥ ثانية (مع كل مزامنة)،
// مما يبطئ الموقع ويجعل الصور تُعاد تحميلها. الرابط صالح ساعة، فنعيد استخدامه ٤٥ دقيقة.
const SIGN_TTL = 3600;
const REUSE_MS = 45 * 60 * 1000;
const signedCache = new Map<string, { url: string; at: number }>();

async function signPaths(paths: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const now = Date.now();
  const need: string[] = [];
  for (const p of new Set(paths)) {
    const hit = signedCache.get(p);
    if (hit && now - hit.at < REUSE_MS) out.set(p, hit.url);
    else need.push(p);
  }
  for (let i = 0; i < need.length; i += 100) {
    const chunk = need.slice(i, i + 100);
    const { data, error } = await supabase.storage.from('work-attachments').createSignedUrls(chunk, SIGN_TTL);
    if (error) throw new Error(error.message);
    for (const item of data ?? []) {
      if (item.path && item.signedUrl) {
        signedCache.set(item.path, { url: item.signedUrl, at: now });
        out.set(item.path, item.signedUrl);
      }
    }
  }
  return out;
}

export function installSiteCloud(onSignOut: () => void) {
  const api = {
    async login(email: string, password: string) {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      await identity();
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
      const byId = new Map(users.map(u => [u.fid, u]));
      const rows = [];
      for (let offset = 0; ; offset += 500) {
        const batch = checked(await supabase.from('entries').select('*').order('created_at').range(offset, offset + 499));
        rows.push(...batch);
        if (batch.length < 500) break;
      }
      // جمع كل مسارات المرفقات وتوقيعها دفعة واحدة
      const allPaths: string[] = [];
      for (const r of rows) {
        const atts = r.meta && typeof r.meta === 'object' && !Array.isArray(r.meta) ? (r.meta as Record<string, Json>)['atts'] : null;
        if (Array.isArray(atts)) for (const a of atts) {
          if (a && typeof a === 'object' && !Array.isArray(a) && typeof a['path'] === 'string') allPaths.push(a['path']);
        }
      }
      const signed = await signPaths(allPaths);
      const entries = rows.map(r => {
        const profile = byId.get(r.owner_id);
        const meta: Record<string, Json | undefined> = r.meta && typeof r.meta === 'object' && !Array.isArray(r.meta) ? { ...r.meta } : {};
        const atts = meta['atts'];
        if (Array.isArray(atts)) {
          // أمان: نتجاهل أي مرفق بلا مسار تخزين حقيقي (يمنع حقن روابط/أكواد عبر قاعدة البيانات مباشرة)
          meta['atts'] = atts.flatMap(a => {
            if (!a || typeof a !== 'object' || Array.isArray(a) || typeof a['path'] !== 'string') return [];
            const url = signed.get(a['path']);
            return url ? [{ ...a, data: url }] : [];
          });
        }
        return { id: r.client_id, fid: r.id, type: r.type, name: profile?.name ?? 'مستخدمة', username: profile?.username ?? '', text: r.text, meta, ts: Date.parse(r.created_at) };
      });
      const configResult = await supabase.from('site_config').select('*').eq('id', 'main').maybeSingle();
      if (configResult.error) throw configResult.error;
      const config = configResult.data;
      return { users, entries, session: byId.get(uid)?.username, uid, config, email: auth.user.email };
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
      // نقرأ المرفقات أولًا ثم نحذف السجل ثم الملفات، حتى لا تبقى ملفات يتيمة في التخزين
      const found = await supabase.from('entries').select('meta').eq('id', id).maybeSingle();
      const { error } = await supabase.from('entries').delete().eq('id', id);
      if (error) throw error;
      const atts = found.data?.meta && typeof found.data.meta === 'object' && !Array.isArray(found.data.meta)
        ? (found.data.meta as Record<string, Json>)['atts'] : null;
      if (Array.isArray(atts)) {
        const paths = atts.flatMap(a => (a && typeof a === 'object' && !Array.isArray(a) && typeof a['path'] === 'string') ? [a['path']] : []);
        if (paths.length) {
          await supabase.storage.from('work-attachments').remove(paths); // أخطاء التنظيف لا تُفشل الحذف
          paths.forEach(p => signedCache.delete(p));
        }
      }
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
      // كان الخروج يفشل إذا انتهت الجلسة (identity ترمي خطأ) فتبقى المستخدمة عالقة. الآن نخرج دائمًا.
      try {
        const { data } = await supabase.auth.getUser();
        if (data.user) await supabase.from('profiles').update({ last_logout: new Date().toISOString() }).eq('id', data.user.id);
      } catch { /* لا نمنع الخروج بسبب تسجيل وقت الخروج */ }
      signedCache.clear();
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
