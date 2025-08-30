import { defineConfig } from 'vite'
import { resolve } from 'node:path'

// Multi-page app configuration so Vite bundles all HTML entries
export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        index: resolve(__dirname, 'index.html'),
        home: resolve(__dirname, 'home.html'),
        login: resolve(__dirname, 'login.html'),
        loginOg: resolve(__dirname, 'loginOg.html'),
        account: resolve(__dirname, 'account.html'),
        accountSetup: resolve(__dirname, 'accountSetup.html'),
        createBook: resolve(__dirname, 'createBook.html'),
        readBook: resolve(__dirname, 'readBook.html'),
        popup: resolve(__dirname, 'popup.html'),
        credits: resolve(__dirname, 'credits.html'),
        pricing: resolve(__dirname, 'pricing.html'),
        bookDetails: resolve(__dirname, 'bookDetails.html'),
      },
    },
  },
})
