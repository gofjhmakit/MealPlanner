/**
 * The "copy the page HTML" bookmarklet, as a single `javascript:` URL the user pastes into
 * a browser bookmark. Tapping it on a recipe page copies the rendered page source to the
 * clipboard (for the HTML import). It runs only on the current page and sends nothing.
 *
 * `\n` is written as `\\n` so the copied text carries the literal escape the bookmarklet
 * interprets at run time; ä and → are plain characters (this file is UTF-8).
 */
export const BOOKMARKLET =
  "javascript:(function(){try{var h='<!doctype html>\\n'+document.documentElement.outerHTML;" +
  'navigator.clipboard.writeText(h).then(' +
  "function(){alert('Sivun HTML kopioitu ('+h.length.toLocaleString()+' merkkiä).\\n\\nAvaa Reseptit → Tuo → Liitä sivun HTML ja liitä.')}," +
  "function(){var t=document.createElement('textarea');t.value=h;document.body.appendChild(t);t.select();alert('Valittu. Paina Kopioi.')}" +
  ")}catch(e){alert('Virhe: '+e)}})()"
