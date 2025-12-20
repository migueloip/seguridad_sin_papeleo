App Web Easy secure

Instalacion

Paso 1: Clonar el repositorio
```bash
git clone https://github.com/usuario/ssp.git
```

Paso 2: Instalar dependencias
```bash
cd ssp
npm install
```
Paso 3: Configurar variables de entorno
Crea un archivo `.env` en la raiz del proyecto y agrega las siguientes variables:
```
DATABASE_URL=postgresql://postgres.rreqlmbvdltudgsurlur:Migiip132%40@aws-0-us-west-2.pooler.supabase.com:6543/postgres?pgbouncer=true
DIRECT_URL=postgresql://postgres.rreqlmbvdltudgsurlur:Migiip132%40@db.rreqlmbvdltudgsurlur.supabase.co:5432/postgres
ADMIN_PASSWORD=Migiip132@
CONFIG_ENCRYPTION_SECRET=Migiip132@
SUPABASE_URL=https://rreqlmbvdltudgsurlur.supabase.co
SUPABASE_SERVICE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJyZXFsbWJ2ZGx0dWRnc3VybHVyIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NjEwNTQ1NywiZXhwIjoyMDgxNjgxNDU3fQ.i6tf1ebnOGlBAAhUtPCD5Kra8m87c4FQLLGWq6qvH1s

Paso 4: Iniciar la aplicacion
```bash
npm run dev
```