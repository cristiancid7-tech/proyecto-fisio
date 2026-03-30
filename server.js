require('dotenv').config();
const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const multer = require('multer');
const app = express();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const upload = multer({ storage: multer.memoryStorage() });

app.use(express.json());
app.use(express.static('public'));


// --- RUTAS DE PACIENTES ---
app.get('/buscar-paciente', async (req, res) => {
    const { consulta } = req.query;
    const { data, error } = await supabase
        .from('Pacientes')
        .select('*')
        .or(`Nombre.ilike.%${consulta}%,Apellido_Paterno.ilike.%${consulta}%,Apellido_Materno.ilike.%${consulta}%`)
        .order('Nombre', { ascending: true });
    if (error) return res.status(400).json(error);
    res.json(data || []);
});
// --- RUTA PARA AGREGAR PACIENTE (NUEVO REGISTRO MANUAL) ---
app.post('/agregar-paciente', async (req, res) => {
    // Extraemos todos los campos, incluyendo Ocupación
    const { Nombre, Apellido_Paterno, Apellido_Materno, Telefono, Diagnostico, alergias, Medicamentos, Ocupacion, Fecha_Nacimiento, ant_heredofamiliares, ant_personales } = req.body;

    try {
        const { data, error } = await supabase
            .from('Pacientes')
            .insert([{ 
                Nombre, 
                Apellido_Paterno, 
                Apellido_Materno, 
                Telefono, 
                Fecha_Nacimiento,
                Diagnostico, 
                alergias, 
                ant_heredofamiliares, 
                ant_personales, 
                Medicamentos,
                Ocupacion // <--- Aquí ya incluimos la Ocupación
            }])
            .select();

        if (error) throw error;
        res.status(200).json({ mensaje: "Paciente registrado en FisioCid", data });
    } catch (error) {
        console.error("Error al registrar paciente:", error.message);
        res.status(400).json({ error: error.message });
    }
});
app.get('/datos-paciente/:id', async (req, res) => {
    const { id } = req.params;
    const { data, error } = await supabase
        .from('Pacientes')
        .select('Nombre, Apellido_Paterno, Apellido_Materno, Fecha_Nacimiento') // <--- AGREGAMOS ESTO
        .eq('id', id)
        .single();
    if (error) return res.status(400).json(error);
    res.json(data);
});

// --- RUTA ÚNICA PARA AGREGAR NOTA (CON IMÁGENES) ---
app.post('/agregar-nota', upload.array('imagenes', 5), async (req, res) => {
    try {
        const body = req.body;
        const files = req.files;
        let nombresImagenes = [];

        // 1. Subir imágenes si existen
        if (files && files.length > 0) {
            for (const file of files) {
                const nombreArchivo = `${Date.now()}_${file.originalname}`;
                const { error: uploadError } = await supabase.storage
                    .from('imagenes_evolucion')
                    .upload(nombreArchivo, file.buffer, { contentType: file.mimetype });
                if (uploadError) throw uploadError;
                nombresImagenes.push(nombreArchivo);
            }
        }

        // 2. Insertar en la tabla Evolucion
        const nuevaNota = {
            id: parseInt(body.id),
            fecha: body.fecha || new Date().toISOString().split('T')[0],
            motivo_consulta: body.motivo_consulta,
            escala_dolor: parseInt(body.escala_dolor) || 0,
            ejercicios: body.ejercicios || "",
            nota_evolucion: body.nota_evolucion,
            recomendaciones: body.recomendaciones || "",
            hallazgos_eco: body.hallazgos_eco || "",
            hallazgos_rx: body.hallazgos_rx || "",
            url_imagen: nombresImagenes.join(','),
            proxima_cita: body.proxima_cita && body.proxima_cita !== "" ? body.proxima_cita : null
        };

        const { error: errEvo } = await supabase.from('Evolucion').insert([nuevaNota]);
        if (errEvo) throw errEvo;

        // 3. ¡LO NUEVO! Si hay una próxima cita, agendarla en la tabla Citas automáticamente
        if (body.proxima_cita && body.hora_proxima) {
            const { error: errCita } = await supabase
                .from('Citas')
                .insert([{
                    id_paciente: parseInt(body.id),
                    fecha: body.proxima_cita,
                    hora: body.hora_proxima,
                    estado: 'Pendiente' // O el estado que prefieras
                }]);
            if (errCita) console.error("Error al auto-agendar:", errCita.message);
        }

        res.status(200).json({ mensaje: "¡Sesión y Próxima Cita guardadas en FisioCid!" });
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

// NUEVA RUTA PARA EL AUTOCOMPLETADO (DATALIST)
app.get('/obtener-pacientes', async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('Pacientes')
            .select('Nombre, Apellido_Paterno, Telefono, direccion_predeterminada') // Traemos lo necesario
            .order('Nombre', { ascending: true });

        if (error) throw error;
        res.json(data || []);
    } catch (error) {
        console.error("Error en FisioCid al obtener lista:", error.message);
        res.status(500).json({ error: error.message });
    }
});
// --- RUTA PARA ACTUALIZAR NOTA (EDITAR) ---
app.put('/actualizar-nota/:id', upload.array('imagenes', 5), async (req, res) => {
    try {
        const { id } = req.params;
        const b = req.body;
        
        // 1. Mapeo exacto de los nombres de tu tabla en Supabase
        let datosUpdate = {
            fecha: b.fecha,
            motivo_consulta: b.motivo_consulta,
            escala_dolor: parseInt(b.escala_dolor) || 0,
            nota_evolucion: b.nota_evolucion,
            ejercicios: b.ejercicios || "",
            hallazgos_eco: b.hallazgos_eco || "",
            hallazgos_rx: b.hallazgos_rx || "",
            recomendaciones: b.recomendaciones || "",
            proxima_cita: b.proxima_cita && b.proxima_cita !== "" ? b.proxima_cita : null
        };

        // 2. Solo actualizamos la URL de imagen si realmente se subieron fotos nuevas
        if (req.files && req.files.length > 0) {
            let nuevosNombres = [];
            for (const file of req.files) {
                const nombreArchivo = `${Date.now()}_${file.originalname}`;
                await supabase.storage.from('imagenes_evolucion').upload(nombreArchivo, file.buffer, { contentType: file.mimetype });
                nuevosNombres.push(nombreArchivo);
            }
            datosUpdate.url_imagen = nuevosNombres.join(',');
        }

        // 3. Ejecutar la actualización en Supabase
        const { error } = await supabase
            .from('Evolucion')
            .update(datosUpdate)
            .eq('id_nota', id); 

        if (error) throw error;
        res.json({ mensaje: "Actualizado" });
    } catch (error) {
        console.error("ERROR CRÍTICO:", error.message);
        res.status(400).json({ error: error.message });
    }
});
// --- RUTA PARA ACTUALIZAR DATOS DEL PACIENTE ---
app.put('/actualizar-paciente/:id', async (req, res) => {
    const { id } = req.params;
    const datosNuevos = req.body;

    try {
        const { error } = await supabase
            .from('Pacientes')
            .update(datosNuevos)
            .eq('id', id);

        if (error) throw error;
        res.json({ mensaje: "Información actualizada en FisioCid" });
    } catch (error) {
        console.error("Error al actualizar paciente:", error.message);
        res.status(400).json({ error: error.message });
    }
});
app.get('/historial-paciente/:id', async (req, res) => {
    const { id } = req.params;
    const { data, error } = await supabase.from('Evolucion').select('*').eq('id', id).order('fecha', { ascending: false });
    if (error) return res.status(400).json(error);
    res.json(data || []);
});

app.delete('/eliminar-nota/:id', async (req, res) => {
    const { error } = await supabase.from('Evolucion').delete().eq('id_nota', req.params.id);
    if (error) return res.status(400).json(error);
    res.json({ mensaje: "Eliminado" });
});

app.get('/ver-agenda', async (req, res) => {
    // Aceptamos tanto 'fecha' como 'fecha_busqueda' para evitar errores
    const fechaParaFiltrar = req.query.fecha || req.query.fecha_busqueda;

    if (!fechaParaFiltrar) {
        return res.status(400).json({ error: "Falta la fecha para consultar la agenda" });
    }

    try {
        const { data, error } = await supabase
            .from('Citas')
            .select(`
                id_cita,
                hora, 
                estado,
                Pacientes ( Nombre, Apellido_Paterno, Telefono )
            `)
            .eq('fecha', fechaParaFiltrar) 
            .order('hora', { ascending: true });

        if (error) throw error;
        res.json(data);
    } catch (error) {
        console.error("Error en agenda:", error.message);
        res.status(400).json({ error: error.message });
    }
});

// Ruta para verificar qué horarios ya están apartados en FisioCid
// Esta es la ruta que falta y causa el error 404
app.get('/horarios-ocupados', async (req, res) => {
    const { fecha } = req.query;
    try {
        const { data, error } = await supabase
            .from('Citas')
            .select('hora')
            .eq('fecha', fecha)
            // IMPORTANTE: Solo bloqueamos si la cita NO está rechazada o eliminada
            .not('estado', 'eq', 'RECHAZADA')
            .not('estado', 'eq', 'ELIMINADA');

        if (error) throw error;
        
        // Enviamos solo las horas ocupadas al frontend
        res.json(data.map(c => c.hora));
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});
// RUTA DE REGISTRO COMPLETO (Corregida y Cerrada)
// Dentro de tu ruta de registro/agendado en server.js
app.post('/registro-recepcion-completo', async (req, res) => {
    try {
        // Limpiamos espacios nuevamente por seguridad
        const nombre = req.body.nombre.trim().toUpperCase();
        const ap = req.body.ap.trim().toUpperCase();
        const am = req.body.am.trim().toUpperCase();
        const tel = req.body.tel.trim();
        const { fecha_nac, fecha_cita, hora_cita } = req.body;

        // 1. BUSCAR SI EL PACIENTE YA EXISTE (Por Nombre, Apellido y Fecha de Nacimiento)
        const { data: existente, error: errBusca } = await supabase
            .from('Pacientes')
            .select('id')
            .eq('Nombre', nombre)
            .eq('Apellido_Paterno', ap)
            .eq('Fecha_Nacimiento', fecha_nac)
            .maybeSingle(); // Usamos maybeSingle para que no de error si no hay nadie

        if (errBusca) throw errBusca;

        let idFinal;

        if (existente) {
            // SI EXISTE: Solo actualizamos el teléfono (por si es nuevo)
            const { data: actualizado } = await supabase
                .from('Pacientes')
                .update({ Telefono: tel, Apellido_Materno: am })
                .eq('id', existente.id)
                .select();
            idFinal = existente.id;
        } else {
            // NO EXISTE: Creamos el registro desde cero
            const { data: nuevo, error: errNuevo } = await supabase
                .from('Pacientes')
                .insert([{ 
                    Nombre: nombre, 
                    Apellido_Paterno: ap, 
                    Apellido_Materno: am, 
                    Telefono: tel,
                    Fecha_Nacimiento: fecha_nac 
                }])
                .select();
            if (errNuevo) throw errNuevo;
            idFinal = nuevo[0].id;
        }

        // 2. INSERTAR LA CITA vinculada al ID encontrado/creado
        const { error: errCita } = await supabase
            .from('Citas')
            .insert([{ 
                id_paciente: idFinal, 
                fecha: fecha_cita, 
                hora: hora_cita,
                estado: 'Pendiente'
            }]);

        if (errCita) throw errCita;

        // 3. RESPUESTA DE ÉXITO (Esto descongela el botón)
        res.status(200).json({ mensaje: "Registro completado con éxito" });

    } catch (error) {
        console.error("Error en proceso:", error.message);
        res.status(500).json({ error: error.message });
    }
});
// RUTA PARA CAMBIAR ESTADOS (Confirmar, Rechazar, Ausente)
app.post('/actualizar-estado-cita', async (req, res) => {
    const { id, nuevoEstado } = req.body;
    try {
        const { error } = await supabase
            .from('Citas')
            .update({ estado: nuevoEstado })
            .eq('id_cita', id);

        if (error) throw error;
        res.json({ mensaje: "Estado actualizado correctamente" });
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

app.get('/obtener-citas-semanales', async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('Citas')
            .select(`*, Pacientes(Nombre, Apellido_Paterno)`)
            // LA CORRECCIÓN: Solo traer citas que estén Pendientes o Confirmadas
            .in('estado', ['Pendiente', 'CONFIRMADA', 'AUSENTE']); 

        if (error) throw error;
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});
app.get('/citas-semana', async (req, res) => {
    const hoy = new Date().toISOString().split('T')[0];
    const proximaSemana = new Date();
    proximaSemana.setDate(proximaSemana.getDate() + 7);
    const limite = proximaSemana.toISOString().split('T')[0];

    try {
        const { data, error } = await supabase
            .from('Citas')
            .select('*, Pacientes(Nombre, Apellido_Paterno)') 
            .gte('fecha', hoy)
            .lte('fecha', limite)
            // ESTO ES LO QUE FALTA: Solo mostrar las que no has rechazado
            .in('estado', ['Pendiente', 'CONFIRMADA', 'AUSENTE']) 
            .order('fecha', { ascending: true })
            .order('hora', { ascending: true });

        if (error) throw error;
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});
// Ruta para alimentar el Inbox de Citas por Confirmar
app.get('/ver-pendientes-globales', async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('Citas') 
            .select(`
                id_cita, fecha, hora, estado,
                Pacientes ( Nombre, Apellido_Paterno, Telefono )
            `)
            .eq('estado', 'Pendiente') // Solo las que no has confirmado
            .order('fecha', { ascending: true });

        if (error) throw error;
        res.json(data);
    } catch (error) {
        console.error("Error en pendientes:", error.message);
        res.status(500).json({ error: error.message });
    }
});
async function cargarPendientesGlobales() {
    try {
        // Asumiendo que creamos una ruta en tu servidor para esto
        const res = await fetch('/ver-pendientes-globales'); 
        const citas = await res.json();
        const cuerpo = document.getElementById('cuerpo-pendientes-general');
        
        if (citas.length === 0) {
            document.getElementById('seccion-pendientes').style.display = 'none'; // Se oculta si no hay nada
            return;
        }

        document.getElementById('seccion-pendientes').style.display = 'block';
        cuerpo.innerHTML = citas.map(c => `
            <tr>
                <td>${c.fecha}</td>
                <td><b>${c.hora.slice(0,5)} hrs</b></td>
                <td>${c.Pacientes.Nombre} ${c.Pacientes.Apellido_Paterno}</td>
                <td>
                    <button class="btn btn-confirm" onclick="confirmarCita(${c.id_cita}, '${c.Pacientes.Nombre}', '${c.Pacientes.Telefono}', '${c.fecha}', '${c.hora.slice(0,5)}')">Confirmar</button>
                    <button class="btn btn-reject" onclick="rechazarCita(${c.id_cita}, '${c.Pacientes.Nombre}', '${c.Pacientes.Telefono}', '${c.fecha}', '${c.hora.slice(0,5)}')">Rechazar</button>
                </td>
            </tr>
        `).join('');
    } catch (error) {
        console.log("Aún no tienes la ruta de pendientes globales configurada.");
    }
}

app.delete('/eliminar-paciente/:id', async (req, res) => {
    const { id } = req.params;
    try {
        // 1. Borramos primero sus evoluciones y citas (opcional si tienes CASCADE en Supabase)
        await supabase.from('Evolucion').delete().eq('id', id);
        await supabase.from('Citas').delete().eq('id_paciente', id);

        // 2. Ahora sí, borramos al paciente
        const { error } = await supabase
            .from('Pacientes')
            .delete()
            .eq('id', id);

        if (error) throw error;
        res.json({ mensaje: "Paciente eliminado de FisioCid" });
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

const PORT = process.env.PORT || 3000; 
app.listen(PORT, () => {
    console.log(`🚀 FisioCid listo en puerto ${PORT}`);
});