# PRÉSTAMOS VR — Backend + Frontend

Sistema de gestión de préstamos de Valerie Barros & Camilo Reyes. Migrado desde una app de
un solo archivo HTML con `localStorage` a una arquitectura real de **backend (API REST +
MongoDB) + frontend**, pensada para desplegarse como un solo proyecto en **Vercel**.

## Estructura

```
api/index.js       → entry point serverless de Vercel (toda la API vive aquí)
backend/            → Express, modelos Mongoose, lógica de negocio, rutas
public/              → frontend (mismo HTML/CSS de siempre + js/api.js + js/app.js)
server.js             → entry point para correr todo en local (node server.js)
vercel.json            → configuración de despliegue
```

La lógica financiera (generación de cuotas, mora, capital disponible, ganancia neta de
fondeo, etc.) vive en el backend (`backend/lib/calc.js` y `backend/routes/*`). El frontend
es un cliente delgado: al cargar pide `GET /api/state` y con eso pinta toda la interfaz;
cada acción (crear cliente, registrar pago, etc.) llama a la API y vuelve a pedir el estado.

## 1. Crear la base de datos (MongoDB Atlas — gratis)

1. Entra a https://www.mongodb.com/cloud/atlas/register y crea una cuenta (o inicia sesión
   si ya tienes una, igual que en tus otros proyectos `votaciones-backend`/`motoskar-backend`).
2. Crea un cluster **Free (M0)** — cualquier región cercana está bien.
3. En **Database Access**, crea un usuario de base de datos con usuario/contraseña (guárdalos).
4. En **Network Access**, agrega `0.0.0.0/0` (permitir desde cualquier IP) — necesario porque
   Vercel no tiene IPs fijas.
5. En **Database → Connect → Drivers**, copia la cadena de conexión. Se ve así:
   `mongodb+srv://usuario:password@cluster0.xxxxx.mongodb.net/?retryWrites=true&w=majority`
   Agrégale el nombre de la base al final, antes del `?`, por ejemplo:
   `mongodb+srv://usuario:password@cluster0.xxxxx.mongodb.net/prestamos_vr?retryWrites=true&w=majority`

## 2. Configurar variables de entorno

```bash
cp .env.example .env
```

Edita `.env` y coloca:
- `MONGO_URI` → la cadena del paso anterior.
- `JWT_SECRET` → cualquier cadena larga y aleatoria (por ejemplo, generada con
  `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`).
- `ADMIN_USER` / `ADMIN_PASS` → usuario/clave inicial de acceso al sistema (se puede cambiar
  después desde Configuración → Seguridad, una vez dentro).

## 3. Correr en local

```bash
npm install
npm run dev        # equivalente a: node server.js
```

Abre http://localhost:3000 — es la misma interfaz de siempre, ahora respaldada por la API
y MongoDB en vez de `localStorage`.

## 4. Desplegar en Vercel

1. Sube este proyecto a un repositorio de GitHub (o usa `vercel` CLI directo desde la carpeta).
2. En https://vercel.com, importa el repo (o corre `vercel` desde la carpeta del proyecto).
3. En **Project Settings → Environment Variables**, agrega las mismas variables del `.env`:
   `MONGO_URI`, `JWT_SECRET`, `ADMIN_USER`, `ADMIN_PASS`.
4. Despliega. Vercel detecta automáticamente `api/index.js` como función serverless y sirve
   `public/` como sitio estático — no hace falta build step.

## Notas de esta migración

- **Login:** sigue siendo un solo usuario compartido (como antes), pero ahora la contraseña
  se guarda con hash (bcrypt) en la base de datos y la sesión usa una cookie `httpOnly`
  firmada (JWT) en vez de comparar strings en el navegador.
- **Pagos parciales:** en el modal "Registrar Pago" solo están implementadas de verdad las
  opciones que ya funcionaban en la versión original — *Pagar cuota*, *Cancelar crédito* y
  *Sumar intereses pendientes al capital*. Las demás (*Abono extra*, *Vencidas*, *Seleccionar
  cuotas*, *Personalizado*, *Solo intereses pendientes*) siguen visibles en la interfaz pero
  responden "no implementado", igual que en el HTML original.
- **Excel/JSON:** los botones de exportar/importar siguen siendo un aviso informativo, sin
  funcionalidad real — igual que en la versión original.
- **Corrección menor:** en el HTML original las pestañas (Préstamos: Todos/Activos/Mora/Pagados,
  Cobranzas: Pendientes/Vencidas/Historial, Configuración: Seguridad/Parámetros) no tenían el
  JavaScript que las hacía cambiar de panel al hacer clic. Se agregó ese manejo genérico en
  `public/js/app.js`, ya que el HTML/CSS claramente estaban pensados para eso.
