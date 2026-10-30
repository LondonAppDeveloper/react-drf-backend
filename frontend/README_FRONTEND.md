# MeatME - Frontend

Sistema de gestión profesional para productos cárnicos construido con React + Vite.

## 🚀 Características

- **Dashboard** con KPIs en tiempo real
- **Gestión de Productos** con búsqueda y filtros
- **Gestión de Clientes** vinculados a vendedores
- **Workflow de Pedidos** en 3 pasos con validación de stock
- **Facturación** con control de pagos
- **Vista de Stock** consolidada
- **Autenticación** con contexto de usuario
- **Diseño Responsivo** optimizado para desktop y tablet

## 🛠️ Stack Tecnológico

- **React 18** - Framework principal
- **Vite** - Build tool y dev server
- **TypeScript** - Tipado estático
- **Tailwind CSS** - Estilos utility-first
- **shadcn/ui** - Componentes UI
- **React Router** - Navegación
- **React Query** - Gestión de estado del servidor
- **Axios** - Cliente HTTP
- **React Hook Form** - Manejo de formularios
- **Zod** - Validación de schemas

## 📦 Instalación

```bash
# Instalar dependencias
npm install

# Copiar variables de entorno
cp .env.example .env

# Configurar la URL del backend en .env
VITE_API_URL=http://localhost:8000/api
```

## 🏃 Ejecución

```bash
# Modo desarrollo
npm run dev

# Build para producción
npm run build

# Preview del build
npm run preview
```

## 🔧 Configuración

### Variables de Entorno

Crear un archivo `.env` en la raíz del proyecto:

```env
VITE_API_URL=http://localhost:8000/api
```

### Backend Django REST

Asegúrese de que el backend esté corriendo en `http://localhost:8000` con los siguientes endpoints:

- `GET/POST /productos/`
- `PUT /productos/:id/`
- `GET/POST /clientes/`
- `GET/POST /pedidos/`
- `POST /pedidos/cancelar/`
- `POST /pedidos/actualizar_kilos/:id/`
- `GET/POST /facturas/`
- `POST /facturas/pagar/`
- `GET /stock/`
- `GET /vendedores/`

## 📁 Estructura del Proyecto

```
src/
├── components/
│   ├── layout/          # Sidebar, Layout principal
│   ├── shared/          # Componentes reutilizables
│   └── ui/              # Componentes shadcn/ui
├── contexts/            # Contextos de React (Auth)
├── hooks/               # Custom hooks
├── pages/               # Páginas/Vistas
│   ├── Dashboard.tsx
│   ├── Login.tsx
│   ├── Productos.tsx
│   ├── Clientes.tsx
│   ├── Pedidos.tsx
│   ├── PedidoNuevo.tsx
│   ├── Facturas.tsx
│   └── Stock.tsx
├── services/            # API service y clients
├── types/               # TypeScript types
├── App.tsx              # Componente raíz con routing
└── main.tsx            # Entry point
```

## 🎨 Sistema de Diseño

El proyecto usa un sistema de diseño basado en tokens semánticos:

- **Colores Primarios**: Rojo carne (#C41E3A) para branding
- **Colores Secundarios**: Verde oscuro para estados positivos
- **Neutrales**: Escala de grises profesional
- **Acentos**: Naranja para alertas, azul para información

Todos los colores están definidos en `src/index.css` usando variables CSS (HSL).

## 🔐 Autenticación

La autenticación está implementada con un mock de contexto en `src/contexts/AuthContext.tsx`.

**Para desarrollo**: Cualquier usuario/contraseña funcionará.

**Para producción**: Reemplazar el mock con llamadas reales al endpoint de autenticación del backend.

## 🚧 Próximos Pasos

1. Conectar todos los endpoints del backend
2. Implementar React Query hooks personalizados
3. Agregar validación de formularios con Zod
4. Implementar manejo de errores global
5. Agregar tests unitarios y de integración
6. Optimizar rendimiento con lazy loading
7. Implementar persistencia de sesión con tokens JWT

## 📝 Notas de Desarrollo

- El proyecto usa **TypeScript strict mode**
- Componentes construidos siguiendo el patrón de composición
- Estilos mediante clases de Tailwind (sin CSS inline)
- Manejo de estado del servidor con React Query
- Validación de formularios con Zod schemas

## 🤝 Contribución

Para contribuir al proyecto:

1. Fork del repositorio
2. Crear rama de feature (`git checkout -b feature/AmazingFeature`)
3. Commit cambios (`git commit -m 'Add some AmazingFeature'`)
4. Push a la rama (`git push origin feature/AmazingFeature`)
5. Abrir Pull Request

## 📄 Licencia

Este proyecto es privado y confidencial.
