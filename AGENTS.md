<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

- Keep the imported interactive site in `public/site.html`, hosted by the index iframe, so branding changes preserve its existing workflows.
- Store supplied logo crops as CDN asset pointers and use the supplied artwork on matching light/dark surfaces; derive the favicon from the same artwork.
- Bridge the same-origin imported iframe to the generated Cloud browser client in a client-only mount; keep activity authorization in database/storage RLS so public HTML cannot grant access.
- Store project roles separately and assign manager access only to an explicitly identified authenticated account; usernames never authorize administration.
- Keep attachment bodies in private Cloud storage and resolve short-lived links for authorized viewers; submissions store paths rather than base64 data.
