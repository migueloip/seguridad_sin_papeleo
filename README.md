App Web Easy Secure

Aplicación web enfocada en la gestión y seguridad de información, desarrollada con Node.js y base de datos Supabase.

🧩 Requisitos previos

Asegúrate de tener instalado lo siguiente antes de comenzar:

Node.js (versión recomendada: LTS)

Base de datos Supabase (proyecto creado y activo)

🚀 Instalación
Paso 1: Clonar el repositorio
git clone https://github.com/migueloip/seguridad_sin_papeleo

Paso 2: Instalar dependencias
cd seguridad_sin_papeleo
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

🏗️ Obra integral

Módulo para coordinar toda la obra, no solo prevención (ruta /obra). Detalle en docs/PLAN-OBRA-INTEGRAL.md.

- Equipo por roles: gerente (dueño del proyecto), jefe de obra, prevencionista, supervisor, trabajador y visita/ITO. Cada uno ve y hace solo lo que permite su rol.
- Planos por especialidad como capas por nivel (arquitectura, alcantarillado, eléctrico, agua, gas…), desde imagen, PDF o DXF, alineables entre sí.
- Hallazgos ubicados en el plano: el sistema calcula qué redes o elementos pasan cerca (p. ej. "a 1,2 m pasa el colector Ø160") y propone tareas.
- Toda sugerencia (de reglas o de IA) queda pendiente hasta que una persona con el rol adecuado la aprueba, la edita o la descarta. Todo queda en la auditoría.
- Tareas, revisiones programadas y una API móvil para que el trabajador vea y cierre sus tareas en terreno.

Cómo empezar:

1. Con la app corriendo, entra a "Obra integral" en el menú lateral (o en /obra). La migración 006 se aplica sola al primer uso; para aplicarla a mano usa POST /api/admin/migrate?scope=obra o scripts/006-obra-integral.sql (y define OBRA_AUTO_MIGRATE=0).
2. Elige una obra, agrega a tu equipo en "Equipo" y sube los planos en "Planos".
3. Para probar con datos de ejemplo (el correo debe ser de un usuario ya registrado):

   DATABASE_URL=postgres://... npm run seed:obra-demo -- --owner-email tu@correo.cl

   Crea la obra "Edificio Demo Los Aromos" con planos, un hallazgo junto al colector y usuarios demo (*.demo@losaromos.test; cada cuenta recibe una clave aleatoria que el script muestra una sola vez). No borra datos existentes. Solo corre contra una BD local, salvo que agregues --allow-remote.

Pruebas del módulo: npm run test (unitarias) y npm run test:obra:int (integración; necesita un Postgres local, ver AGENTS.md).
