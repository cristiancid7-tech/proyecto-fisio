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
        const files = req.files;
        
        let datosUpdate = {
            fecha: b.fecha,
            motivo_consulta: b.motivo_consulta,
            escala_dolor: parseInt(b.escala_dolor),
            nota_evolucion: b.nota_evolucion,
            ejercicios: b.ejercicios,
            hallazgos_eco: b.hallazgos_eco,
            hallazgos_rx: b.hallazgos_rx,
            recomendaciones: b.recomendaciones,
            proxima_cita: b.proxima_cita || null
        };

        if (files && files.length > 0) {
            let nuevosNombres = [];
            for (const file of files) {
                const nombreArchivo = `${Date.now()}_${file.originalname}`;
                await supabase.storage.from('imagenes_evolucion').upload(nombreArchivo, file.buffer, { contentType: file.mimetype });
                nuevosNombres.push(nombreArchivo);
            }
            datosUpdate.url_imagen = nuevosNombres.join(',');
        }

        const { error } = await supabase.from('Evolucion').update(datosUpdate).eq('id_nota', id);
        if (error) throw error;
        res.json({ mensaje: "Actualizado correctamente" });
    } catch (error) {
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

app.post('/registro-recepcion-completo', async (req, res) => {
    const { nombre, ap, am, fecha_nac, tel, fecha, hora } = req.body;

    try {
        let { data: paciente, error: errBusqueda } = await supabase
            .from('Pacientes')
            .select('id')
            .eq('Telefono', tel)
            .maybeSingle();

        if (errBusqueda) throw errBusqueda;

        let idFinal;

        if (!paciente) {
            const { data: nuevoP, error: errP } = await supabase
                .from('Pacientes')
                .insert([{ 
                    Nombre: nombre, 
                    Apellido_Paterno: ap, 
                    Apellido_Materno: am, 
                    Telefono: tel, 
                    Fecha_Nacimiento: fecha_nac 
                }])
                .select(); 
            
            if (errP) throw errP;
            idFinal = nuevoP[0].id;
        } else {
            idFinal = paciente.id;
        }

        const { error: errCita } = await supabase
            .from('Citas') 
            .insert([{
                id_paciente: idFinal,
                fecha: fecha,
                hora: hora,
                estado: 'PENDIENTE',
                sucursal: 'Santiago Miahuatlan'
            }]);

        if (errCita) throw errCita;

        res.json({ mensaje: "Cita agendada con éxito" });

    } catch (error) {
        console.error("DETALLE DEL FALLO:", error.message);
        res.status(400).json({ error: error.message });
    }
});

app.get('/ver-agenda', async (req, res) => {
    const { fecha } = req.query;
    const { data, error } = await supabase
        .from('Citas')
        .select(`
            id_cita,
            hora,
            estado,
            Pacientes ( Nombre, Apellido_Paterno, Telefono )
        `)
        .eq('fecha', fecha)
        .order('hora', { ascending: true });

    if (error) return res.status(400).json(error);
    res.json(data);
});

// --- RUTA PARA ELIMINAR CITA ---
app.delete('/eliminar-cita/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const { error } = await supabase
            .from('Citas')
            .delete()
            .eq('id_cita', id);

        if (error) throw error;
        res.json({ mensaje: "Cita eliminada correctamente" });
    } catch (error) {
        console.error("Error al eliminar:", error.message);
        res.status(400).json({ error: error.message });
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