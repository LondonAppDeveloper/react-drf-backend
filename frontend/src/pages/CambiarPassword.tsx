import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { cambiarPassword } from '@/services/api';

export default function CambiarPassword() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [actual, setActual] = useState('');
  const [nueva, setNueva] = useState('');
  const [confirmar, setConfirmar] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!actual || !nueva || !confirmar) {
      toast({ title: 'Error', description: 'Por favor complete todos los campos', variant: 'destructive' });
      return;
    }
    if (nueva !== confirmar) {
      toast({ title: 'Error', description: 'Las contraseñas nuevas no coinciden', variant: 'destructive' });
      return;
    }
    if (nueva === actual) {
      toast({ title: 'Error', description: 'La nueva contraseña debe ser distinta a la actual', variant: 'destructive' });
      return;
    }

    setIsLoading(true);
    try {
      await cambiarPassword(actual, nueva);
      toast({ title: 'Contraseña actualizada', description: 'Tu contraseña se cambió correctamente' });
      setActual('');
      setNueva('');
      setConfirmar('');
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error?.response?.data?.error || 'No se pudo cambiar la contraseña',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Mi Cuenta</h1>
        <p className="text-muted-foreground">
          {user?.username ? `Usuario: ${user.username}` : 'Configuración de tu cuenta'}
        </p>
      </div>

      <Card className="max-w-md">
        <CardHeader>
          <CardTitle>Cambiar contraseña</CardTitle>
          <CardDescription>Mínimo 8 caracteres, no solo números ni una contraseña común.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="password-actual">Contraseña actual</Label>
              <Input
                id="password-actual"
                type="password"
                autoComplete="current-password"
                value={actual}
                onChange={(e) => setActual(e.target.value)}
                disabled={isLoading}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password-nueva">Nueva contraseña</Label>
              <Input
                id="password-nueva"
                type="password"
                autoComplete="new-password"
                value={nueva}
                onChange={(e) => setNueva(e.target.value)}
                disabled={isLoading}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password-confirmar">Confirmar nueva contraseña</Label>
              <Input
                id="password-confirmar"
                type="password"
                autoComplete="new-password"
                value={confirmar}
                onChange={(e) => setConfirmar(e.target.value)}
                disabled={isLoading}
              />
            </div>
            <Button type="submit" className="w-full" disabled={isLoading}>
              {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Guardar contraseña
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
