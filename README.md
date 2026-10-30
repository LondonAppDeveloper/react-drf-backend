# 🥩 Meets — Sistema de Gestión de Ventas e Inventario

> Plataforma web full stack para la gestión de ventas, inventario, facturación y control de productos, diseñada para optimizar procesos en negocios comerciales.

---

## 🧩 Descripción

**Meets** es una aplicación web orientada a la digitalización de procesos comerciales, permitiendo administrar pedidos, productos, clientes y facturación desde un sistema centralizado.

El sistema está pensado para pequeños y medianos negocios que necesitan mejorar el control de stock, ventas y flujo financiero.

---

## ✨ Funcionalidades principales

| Módulo | Descripción |
|---|---|
| 📦 Inventario | Gestión de stock y entradas de productos |
| 🧾 Facturación | Administración de facturas y pagos |
| 🛒 Pedidos | Gestión y seguimiento de pedidos |
| 👥 Clientes | Gestión de clientes y proveedores |
| 💰 Vendedores | Control de pagos a vendedores |
| 📊 Dashboard | Métricas y resumen del negocio |
| 📁 Comprobantes | Registro de comprobantes de pago |
| 🔐 Auth | Sistema de autenticación de usuarios |
| ⚙️ API REST | Integración frontend-backend |

---

## 🛠️ Tecnologías utilizadas

### Backend
![Python](https://img.shields.io/badge/Python-3776AB?style=flat&logo=python&logoColor=white)
![Django](https://img.shields.io/badge/Django-092E20?style=flat&logo=django&logoColor=white)
![DRF](https://img.shields.io/badge/Django_REST_Framework-ff1709?style=flat&logo=django&logoColor=white)
![SQLite](https://img.shields.io/badge/SQLite-07405E?style=flat&logo=sqlite&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-2496ED?style=flat&logo=docker&logoColor=white)

- **Python** + **Django** + **Django REST Framework**
- **SQLite** — Base de datos para desarrollo
- **Docker** — Contenerización

### Frontend
![React](https://img.shields.io/badge/React_TS-20232A?style=flat&logo=react&logoColor=61DAFB)
![Vite](https://img.shields.io/badge/Vite-646CFF?style=flat&logo=vite&logoColor=white)
![TailwindCSS](https://img.shields.io/badge/Tailwind_CSS-38B2AC?style=flat&logo=tailwind-css&logoColor=white)

- **React** (TypeScript) — Biblioteca UI
- **Vite** — Bundler y entorno de desarrollo
- **Tailwind CSS** — Estilos utilitarios
- **Axios** — Cliente HTTP

---

## 🏗️ Arquitectura

```
meets/
├── backend/
│   ├── core/                # Lógica principal (modelos, vistas, serializers)
│   ├── backend/             # Configuración Django
│   ├── comprobantes_pagos/  # Archivos subidos
│   └── manage.py
└── frontend/
    └── src/
        ├── pages/           # Vistas principales
        ├── components/      # Componentes reutilizables
        ├── services/        # Comunicación con API
        └── contexts/        # Estado global (auth)
```

- **Backend desacoplado** — API REST independiente
- **Frontend SPA** — Single Page Application
- **Separación clara** entre lógica de negocio y presentación
- **Estructura modular** pensada para escalar

---

## ⚙️ Instalación y ejecución

### 1. Clonar el repositorio

```bash
git clone https://github.com/tuusuario/meets.git
cd meets
```

### 2. Backend

```bash
cd backend
pip install -r requirements.txt
python manage.py migrate
python manage.py runserver
```

### 3. Frontend

```bash
cd frontend
npm install
npm run dev
```

### 4. Ejecutar con Docker *(opcional)*

```bash
docker-compose up --build
```

---

## 🔐 Seguridad

- ✅ Separación de frontend y backend
- ✅ Autenticación en API
- ✅ Manejo de datos estructurados mediante serializers
- ✅ Validaciones en backend

---


## 📌 Estado del proyecto

🟢 **Funcional — en desarrollo continuo**

---

## 👨‍💻 Autor

**Benjamin Urrutia**
Estudiante de Ingeniería Civil Informática · Full Stack Developer

---

## 📬 Contacto

- 📧 Email: [benjaminurrutiap@gmail.com](mailto:benjaminurrutiap@gmail.com)
- 🐙 GitHub: [github.com/Ukutia](https://github.com/Ukutia)
