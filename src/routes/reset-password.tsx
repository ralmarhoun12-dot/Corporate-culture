import { createFileRoute, Link } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PASSWORD_HINT, passwordProblem } from '@/lib/password-policy';

export const Route = createFileRoute('/reset-password')({
  head: () => ({ meta: [
    { title: 'استعادة كلمة المرور | الثقافة المؤسسية' },
    { name: 'description', content: 'تعيين كلمة مرور جديدة لحساب الثقافة المؤسسية.' },
    { property: 'og:title', content: 'استعادة كلمة المرور | الثقافة المؤسسية' },
    { property: 'og:description', content: 'استعادة الوصول الآمن إلى حساب الثقافة المؤسسية.' },
    { property: 'og:type', content: 'website' }, { name: 'twitter:card', content: 'summary' },
  ] }), component: ResetPassword,
});

function ResetPassword() {
  const [ready, setReady] = useState(false);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [message, setMessage] = useState('جارٍ التحقق من رابط الاستعادة…');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const hash = window.location.hash;
    const recovery = hash.includes('type=recovery');
    let found = false;
    const ok = () => { found = true; setReady(true); setMessage(''); };
    const { data } = supabase.auth.onAuthStateChange(event => {
      if (event === 'PASSWORD_RECOVERY') ok();
    });
    void supabase.auth.getSession().then(({ data }) => {
      if (recovery && data.session) ok();
      else if (!recovery) setMessage('افتحي رابط الاستعادة المرسل إلى بريدك الإلكتروني.');
    });
    // إصلاح: كان الرابط المنتهي أو المستخدم سابقًا يترك رسالة «جارٍ التحقق» للأبد
    const expired = hash.includes('error=') || hash.includes('error_code=');
    if (expired) setMessage('الرابط منتهي الصلاحية أو مستخدم سابقًا. اطلبي رابطًا جديدًا من صفحة تسجيل الدخول.');
    const timer = setTimeout(() => {
      if (!found && recovery) setMessage('تعذّر التحقق من الرابط. اطلبي رابط استعادة جديدًا من صفحة تسجيل الدخول.');
    }, 8000);
    return () => { clearTimeout(timer); data.subscription.unsubscribe(); };
  }, []);
  return <main className="min-h-dvh bg-background text-foreground flex items-center justify-center px-6">
    <form className="w-full max-w-sm space-y-5" onSubmit={async e => {
      e.preventDefault(); if (!ready) return;
      const problem = passwordProblem(password);
      if (problem) { setMessage(problem); return; }
      if (password !== confirm) { setMessage('كلمتا المرور غير متطابقتين'); return; }
      setBusy(true);
      const { error } = await supabase.auth.updateUser({ password });
      setBusy(false); setMessage(error ? error.message : 'حُفظت كلمة المرور الجديدة. سجّلي الدخول بها الآن.');
      if (!error) { setReady(false); await supabase.auth.signOut(); }
    }}>
      <h1 className="text-2xl font-semibold">استعادة كلمة المرور</h1>
      {ready && <><label htmlFor="new-password">كلمة المرور الجديدة</label><Input id="new-password" type="password" autoComplete="new-password" minLength={10} required value={password} onChange={e => setPassword(e.target.value)} />
        <p className="text-xs text-muted-foreground">{PASSWORD_HINT}</p>
        <label htmlFor="confirm-password">تأكيد كلمة المرور</label><Input id="confirm-password" type="password" autoComplete="new-password" required value={confirm} onChange={e => setConfirm(e.target.value)} />
        <Button type="submit" disabled={busy}>حفظ كلمة المرور</Button></>}
      <p role="status" className="text-sm text-muted-foreground">{message}</p>
      <Button variant="link" asChild><Link to="/">العودة لتسجيل الدخول</Link></Button>
    </form>
  </main>;
}
