/// <reference lib="dom" />
import { contextBridge } from 'electron'

/**
 * Passkeys (WebAuthn) are not offered to pages: Electron has no Chromium's authenticator UI — on Windows its system
 * dialog opens, its answer never reaches the page, the request hangs and the page's input with it. A page told there
 * are none (as a browser without them) offers its other sign-in itself: a password, a code.
 */
contextBridge.executeInMainWorld({
  func: () => {
    try {
      delete (window as { PublicKeyCredential?: unknown }).PublicKeyCredential
    } catch {
      // (not deletable here — left; the requests below are refused all the same)
    }
    const c = navigator.credentials as (CredentialsContainer & Record<'get' | 'create', unknown>) | undefined
    if (!c) return
    const refuse = <T extends (o?: CredentialRequestOptions & CredentialCreationOptions) => Promise<Credential | null>>(own: T) =>
      function (this: CredentialsContainer, o?: CredentialRequestOptions & CredentialCreationOptions) {
        return o?.publicKey ? Promise.reject(new DOMException('Passkeys are not supported in this browser', 'NotSupportedError')) : own.call(this, o)
      }
    c.get = refuse(CredentialsContainer.prototype.get)
    c.create = refuse(CredentialsContainer.prototype.create)
  },
})
