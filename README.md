App Web Easy Secure

Aplicación web enfocada en la gestión y seguridad de información, desarrollada con Node.js y base de datos Supabase.

🧩 Requisitos previos

Asegúrate de tener instalado lo siguiente antes de comenzar:

Node.js (versión recomendada: LTS)

Base de datos Supabase (proyecto creado y activo)

🚀 Instalación
Paso 1: Clonar el repositorio
git clone https://github.com/usuario/ssp.git

Paso 2: Instalar dependencias
cd ssp
npm install

Paso 3: Configurar variables de entorno

Crea un archivo .env en la raíz del proyecto.

⚠️ Por seguridad, las variables de entorno no se incluyen en el repositorio ni en este README.
Debes definirlas manualmente según tu entorno y tu proyecto de Supabase.

Ejemplo de estructura del archivo .env (valores no incluidos):

DATABASE_URL=
DIRECT_URL=
ADMIN_PASSWORD=
CONFIG_ENCRYPTION_SECRET=
SUPABASE_URL=
SUPABASE_SERVICE_KEY=


ℹ️ Estas variables son necesarias para la conexión a la base de datos, autenticación administrativa y cifrado de configuración.
Cada equipo o entorno (desarrollo, staging, producción) debe usar sus propias credenciales.

Paso 4: Iniciar la aplicación
npm run dev


La aplicación quedará disponible en el entorno de desarrollo configurado.