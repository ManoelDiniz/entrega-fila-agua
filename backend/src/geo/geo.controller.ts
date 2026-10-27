import {
  Controller,
  Get,
  NotFoundException,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GeoService } from './geo.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('geo')
export class GeoController {
  constructor(
    private readonly geo: GeoService,
    private readonly config: ConfigService,
  ) {}

  /**
   * A área de entrega que o servidor está REALMENTE aplicando agora.
   *
   * Existe por causa de um bug que se repetiu duas vezes: o Nest lê o `.env` uma
   * única vez, na subida. Editar a cerca e não reiniciar deixa o servidor
   * aplicando a caixa ANTIGA — e nada, em lugar nenhum, denuncia isso. Chegamos a
   * afirmar que endereços de uma região passavam, testando fora do servidor,
   * enquanto o servidor no ar os recusava.
   *
   * Com este endpoint, a área deixa de ser folclore e vira um fato consultável: a
   * tela mostra "a entrega cobre X" com a verdade do servidor, em vez de um texto
   * fixo que pode estar mentindo.
   */
  @Roles('atendente', 'admin', 'entregador')
  @Get('area')
  area() {
    const viewbox = this.config.get<string>('GEO_VIEWBOX') ?? null;
    const [lonMin, latMin, lonMax, latMax] = (viewbox ?? '')
      .split(',')
      .map(Number);

    return {
      /** Nome legível da área — é o que a tela deve mostrar ao atendente. */
      cidades: this.config.get<string>('GEO_CIDADES', 'Fortaleza e Caucaia'),
      viewbox,
      limites: viewbox ? { lonMin, latMin, lonMax, latMax } : null,
      /**
       * Sem cerca, endereço vago cai em outra cidade e vira entrega errada, sem
       * erro nenhum. A tela deve gritar se isto vier `false`.
       */
      cercaAtiva: !!viewbox,
    };
  }

  /**
   * CEP -> rua, bairro, cidade, UF (ViaCEP — gratuito, sem chave).
   *
   *   GET /api/geo/cep/60115-081
   *   -> { cep, logradouro, bairro, cidade, uf }   |   404 se não existir
   *
   * Serve para o atendente preencher o endereço certo ANTES de geocodificar. O
   * Nominatim sozinho não desambigua rua homônima: "Rua Barão de Aracati,
   * Fortaleza" devolve TRÊS ruas, em bairros diferentes. O CEP diz qual é.
   *
   * NÃO devolve coordenadas — o ViaCEP resolve o texto do endereço, não o ponto.
   */
  @Roles('atendente', 'admin')
  @Get('cep/:cep')
  async porCep(@Param('cep') cep: string) {
    const achado = await this.geo.buscarPorCep(cep);
    if (!achado) throw new NotFoundException('CEP não encontrado.');
    return achado;
  }

  /**
   * Busca candidatos de endereço, para o atendente CONFIRMAR o ponto no mapa
   * antes de salvar o cliente.
   *
   *   GET /api/geo/enderecos?q=Rua X, 100&limite=5
   *   -> [{ lat, lng, endereco, precisao, numero, rua, bairro, cidade, uf }]
   *
   * Lista vazia = não encontrado DENTRO DA ÁREA DE ENTREGA (ver `/geo/area`).
   * Nunca 404: aqui 404 significaria "a rota não existe".
   *
   * Vários candidatos são o ponto: um endereço vago casa com mais de um lugar, e
   * quem sabe qual é o certo é o atendente, não o algoritmo.
   *
   * ATENÇÃO: o Nominatim público aceita ~1 requisição por segundo e o GeoService
   * SERIALIZA as chamadas. Autocomplete a cada tecla enfileira e faz a tela
   * parecer travada — use debounce alto ou um botão "Buscar".
   */
  @Roles('atendente', 'admin')
  @Get('enderecos')
  buscar(@Query('q') q: string, @Query('limite') limite?: string) {
    const n = Number(limite);
    const max = Number.isFinite(n) && n > 0 ? Math.min(n, 10) : 5;
    return this.geo.buscarEnderecos(q ?? '', max);
  }
}
