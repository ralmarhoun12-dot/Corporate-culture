CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role app_role)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$ SELECT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=_user_id AND role=_role) $$;

CREATE OR REPLACE FUNCTION public.ensure_profile()
 RETURNS profiles LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$ DECLARE p public.profiles; uid uuid:=auth.uid(); metadata jsonb:=auth.jwt()->'user_metadata'; mail text; confirmed boolean;
BEGIN
 IF uid IS NULL THEN RAISE EXCEPTION 'Unauthorized'; END IF;
 SELECT * INTO p FROM public.profiles WHERE id=uid;
 IF p.id IS NULL THEN
  INSERT INTO public.profiles(id,name,username) VALUES(uid,left(coalesce(nullif(metadata->>'name',''),'مستخدمة'),100),left(coalesce(nullif(metadata->>'username',''),'user_'||replace(uid::text,'-','')),60)) RETURNING * INTO p;
 END IF;
 SELECT lower(email), email_confirmed_at IS NOT NULL INTO mail, confirmed FROM auth.users WHERE id=uid;
 IF confirmed AND mail='admin5102026@gmail.com' THEN
  INSERT INTO public.user_roles(user_id,role) VALUES(uid,'admin') ON CONFLICT (user_id,role) DO NOTHING;
 END IF;
 RETURN p;
END $$;
REVOKE EXECUTE ON FUNCTION public.ensure_profile() FROM anon, public;
GRANT EXECUTE ON FUNCTION public.ensure_profile() TO authenticated;

INSERT INTO public.user_roles(user_id,role)
SELECT id,'admin' FROM auth.users WHERE lower(email)='admin5102026@gmail.com' AND email_confirmed_at IS NOT NULL
ON CONFLICT (user_id,role) DO NOTHING;