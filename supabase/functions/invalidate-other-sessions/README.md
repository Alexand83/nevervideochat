# Edge Function: Invalida Altre Sessioni

Questa Edge Function usa l'Admin API di Supabase per invalidare tutte le altre sessioni dell'utente, mantenendo solo quella corrente.

## Setup

1. **Installa Supabase CLI** (se non l'hai già):
   ```bash
   npm install -g supabase
   ```

2. **Login a Supabase**:
   ```bash
   supabase login
   ```

3. **Link al progetto**:
   ```bash
   supabase link --project-ref kybarxjynjxpagxijpti
   ```

4. **Deploy della funzione**:
   ```bash
   supabase functions deploy invalidate-other-sessions
   ```

5. **Configura le variabili d'ambiente** (già configurate nel dashboard Supabase):
   - `SUPABASE_URL`: Il tuo URL Supabase
   - `SUPABASE_SERVICE_ROLE_KEY`: La tua service role key (dal dashboard)

## Uso dal Client

```javascript
// In js/auth.js, dopo il login:
const { data, error } = await state.supa.auth.signInWithPassword({ email, password });

if (data.session) {
  // Chiama l'Edge Function per invalidare le altre sessioni
  const { data: result, error: funcError } = await state.supa.functions.invoke(
    'invalidate-other-sessions',
    {
      headers: {
        Authorization: `Bearer ${data.session.access_token}`
      }
    }
  );
  
  if (!funcError && result?.success) {
    console.log(`Invalidated ${result.invalidated} other sessions`);
  }
}
```

## Vantaggi

- ✅ **Più sicuro**: Usa Admin API lato server
- ✅ **Più preciso**: Invalida solo le sessioni specifiche
- ✅ **Più affidabile**: Non dipende dal supporto di `scope: 'others'`
- ✅ **Scalabile**: Gestisce molti utenti simultanei

## Costi

- Edge Functions: Gratuite fino a 500K invocazioni/mese (piano Free)
- Poi: $0.0000002 per invocazione
