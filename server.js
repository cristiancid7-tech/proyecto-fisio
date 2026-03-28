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
    const { 
        Nombre, Apellido_Paterno, Apellido_Materno, Telefono, 
        Diagnostico, alergias, ant_heredofamiliares, 
        ant_personales, Ocupacion 
    } = req.body;

    try {
        const { data, error } = await supabase
            .from('Pacientes')
            .insert([{ 
                Nombre, 
                Apellido_Paterno, 
                Apellido_Materno, 
                Telefono, 
                Diagnostico, 
                alergias, 
                ant_heredofamiliares, 
                ant_personales, 
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
        .select('Nombre, Apellido_Paterno, Apellido_Materno')
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

        const { error } = await supabase.from('Evolucion').insert([nuevaNota]);
        if (error) throw error;
        res.status(200).json({ mensaje: "¡Sesión guardada en FisioCid!" });
    } catch (error) {
        res.status(400).json({ error: error.message });
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
// RUTA DE REGISTRO COMPLETO (Corregida y Cerrada)
app.post('/registro-recepcion-completo', async (req, res) => {
    console.log("Cuerpo recibido:", req.body); 
    try {
        // 1. Extraemos los datos del formulario
        const { nombre, ap, am, tel, fecha_nac, ocupacion, fecha_cita, hora_cita } = req.body;

        // 2. Buscamos si el paciente ya existe en FisioCid
        let { data: paciente } = await supabase
            .from('Pacientes')
            .select('id')
            .eq('Nombre', nombre)
            .eq('Apellido_Paterno', ap)
            .maybeSingle();

        let idFinal;
        if (!paciente) {
            // Si es nuevo, lo registramos
            const { data: nuevoP, error: errP } = await supabase
                .from('Pacientes')
                .insert([{ 
                    Nombre: nombre, 
                    Apellido_Paterno: ap, 
                    Apellido_Materno: am, 
                    Telefono: tel, 
                    Fecha_Nacimiento: fecha_nac, 
                    Ocupacion: ocupacion 
                }])
                .select();
            
            if (errP) throw errP;
            idFinal = nuevoP[0].id;
        } else {
            idFinal = paciente.id;
        }

        // 3. Agendamos la cita - Usamos req.body.fecha_cita para que no marque "not defined"
        const { error: errCita } = await supabase
            .from('Citas')
            .insert([{ 
                id_paciente: idFinal, 
                fecha: fecha_cita, 
                hora: hora_cita 
            }]);

        if (errCita) {
            console.error("DETALLE DEL FALLO EN CITAS:", errCita.message);
            throw errCita;
        }

        res.status(200).json({ mensaje: "¡Sesión agendada con éxito en FisioCid!" });

    } catch (error) {
        console.error("DETALLE DEL FALLO EN REGISTRO:", error.message);
        res.status(400).json({ error: error.message });
    }
}); // <--- AQUÍ SE CIERRA LA RUTA CORRECTAMENTE

app.get('/citas-semana', async (req, res) => {
    const hoy = new Date().toISOString().split('T')[0];
    const proximaSemana = new Date();
    proximaSemana.setDate(proximaSemana.getDate() + 7);
    const limite = proximaSemana.toISOString().split('T')[0];

    try {
        const { data, error } = await supabase
            .from('Citas')
            .select('*, Pacientes(Nombre, Apellido_Paterno)') 
            .gte('fecha', hoy) // Usamos 'fecha' como dijiste que se llama
            .lte('fecha', limite)
            .order('fecha', { ascending: true })
            .order('hora', { ascending: true });

        if (error) throw error;
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});
// --- NUEVA RUTA PARA ELIMINAR PACIENTE COMPLETO ---
app.delete('/eliminar-paciente/:id', async (req, res) => {
    const { id } = req.params;
    try {
        // Esto borrará al paciente de la tabla 'Pacientes'
        const { error } = await supabase
            .from('Pacientes')
            .delete()
            .eq('id', id);

        if (error) throw error;
        res.json({ mensaje: "Paciente eliminado de FisioCid" });
    } catch (error) {
        console.error("Error al eliminar paciente:", error.message);
        res.status(400).json({ error: error.message });
    }
});
const PORT = process.env.PORT || 3000; 
app.listen(PORT, () => {
    console.log(`🚀 FisioCid listo en puerto ${PORT}`);
});