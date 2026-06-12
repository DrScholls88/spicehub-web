recipeParser.js:2478 [SpiceHub] Instagram URL Ã¢â‚¬â€ trying embed extraction...
api.js:763 [fetchInstagramJsonDetails] Failed: Unexpected token 'O', "Oops, an e"... is not valid JSON
api.js:677 [fetchInstagramOEmbed] Not configured or error: {message: "(#10) To use 'Meta oEmbed Read', your use of this …https://developers.facebook.com/docs/apps/review.", type: 'OAuthException', code: 10, fbtrace_id: 'ALp-ypRnvis5jPK9DXuT86C'}
api.js:248 [fetchInstagramViaApify] ✅ Got caption (853 chars) + image: yes
Access to fetch at 'https://scontent-lga3-1.cdninstagram.com/v/t51.2885-15/480919542_18263290849274350_7955219054872986511_n.jpg?stp=dst-jpg_e35_p1080x1080_sh2.08_tt6&_nc_ht=scontent-lga3-1.cdninstagram.com&_nc_cat=110&_nc_oc=Q6cZ2gEH1k4NUqbkrCxGzBsd102AvJPQGfO-rNKOaAFbVxvkmXBHIkZvKDY9ytz_uxJTdis&_nc_ohc=BZr2E9ecMJYQ7kNvwFIsnFj&_nc_gid=g3kSU6eMaBHnlAhPNVVk7Q&edm=APs17CUBAAAA&ccb=7-5&oh=00_Af8hfYouO6AIQ-iKxLDEsJGDpHhWSciimpqsHskFlsY6xQ&oe=6A30BB9F&_nc_sid=10d13b' from origin 'https://spicehub-web.vercel.app' has been blocked by CORS policy: No 'Access-Control-Allow-Origin' header is present on the requested resource.
The FetchEvent for "https://scontent-lga3-1.cdninstagram.com/v/t51.2885-15/480919542_18263290849274350_7955219054872986511_n.jpg?stp=dst-jpg_e35_p1080x1080_sh2.08_tt6&_nc_ht=scontent-lga3-1.cdninstagram.com&_nc_cat=110&_nc_oc=Q6cZ2gEH1k4NUqbkrCxGzBsd102AvJPQGfO-rNKOaAFbVxvkmXBHIkZvKDY9ytz_uxJTdis&_nc_ohc=BZr2E9ecMJYQ7kNvwFIsnFj&_nc_gid=g3kSU6eMaBHnlAhPNVVk7Q&edm=APs17CUBAAAA&ccb=7-5&oh=00_Af8hfYouO6AIQ-iKxLDEsJGDpHhWSciimpqsHskFlsY6xQ&oe=6A30BB9F&_nc_sid=10d13b" resulted in a network error response: the promise was rejected.
NetworkOnly.js:93 Uncaught (in promise) no-response: no-response :: [{"url":"https://scontent-lga3-1.cdninstagram.com/v/t51.2885-15/480919542_18263290849274350_7955219054872986511_n.jpg?stp=dst-jpg_e35_p1080x1080_sh2.08_tt6&_nc_ht=scontent-lga3-1.cdninstagram.com&_nc_cat=110&_nc_oc=Q6cZ2gEH1k4NUqbkrCxGzBsd102AvJPQGfO-rNKOaAFbVxvkmXBHIkZvKDY9ytz_uxJTdis&_nc_ohc=BZr2E9ecMJYQ7kNvwFIsnFj&_nc_gid=g3kSU6eMaBHnlAhPNVVk7Q&edm=APs17CUBAAAA&ccb=7-5&oh=00_Af8hfYouO6AIQ-iKxLDEsJGDpHhWSciimpqsHskFlsY6xQ&oe=6A30BB9F&_nc_sid=10d13b","error":{}}]
at Pe._handle (NetworkOnly.js:93:19)
at async Pe._getResponse (Strategy.js:144:24)
_handle @ NetworkOnly.js:93
await in _handle
_getResponse @ Strategy.js:144
await in _getResponse
handleAll @ Strategy.js:135
handle @ Strategy.js:96
handleRequest @ Router.js:197
(anonymous) @ Router.js:56
network request
downloadImageAsDataUrl @ api.js:622
importFromInstagram @ recipeParser.js:4393
await in importFromInstagram
_importRecipeFromUrlInner @ recipeParser.js:2481
importRecipeFromUrl @ recipeParser.js:2429
(anonymous) @ ImportSheet.jsx:92
(anonymous) @ ImportInput.jsx:67
processDispatchQueue @ react-dom-client.production.js:12317
(anonymous) @ react-dom-client.production.js:12867
batchedUpdates$1 @ react-dom-client.production.js:1498
dispatchEventForPluginEventSystem @ react-dom-client.production.js:12455
dispatchEvent @ react-dom-client.production.js:15306
dispatchDiscreteEvent @ react-dom-client.production.js:15274
api.js:622 GET https://scontent-lga3-1.cdninstagram.com/v/t51.2885-15/480919542_18263290849274350_7955219054872986511_n.jpg?stp=dst-jpg_e35_p1080x1080_sh2.08_tt6&_nc_ht=scontent-lga3-1.cdninstagram.com&_nc_cat=110&_nc_oc=Q6cZ2gEH1k4NUqbkrCxGzBsd102AvJPQGfO-rNKOaAFbVxvkmXBHIkZvKDY9ytz_uxJTdis&_nc_ohc=BZr2E9ecMJYQ7kNvwFIsnFj&_nc_gid=g3kSU6eMaBHnlAhPNVVk7Q&edm=APs17CUBAAAA&ccb=7-5&oh=00_Af8hfYouO6AIQ-iKxLDEsJGDpHhWSciimpqsHskFlsY6xQ&oe=6A30BB9F&_nc_sid=10d13b net::ERR_FAILED"