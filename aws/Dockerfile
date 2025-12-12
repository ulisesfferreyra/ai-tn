FROM public.ecr.aws/lambda/nodejs:20

WORKDIR /var/task

COPY package*.json ./

# Configurar más reintentos y usar npm install en lugar de npm ci
RUN npm config set fetch-retries 5 \
  && npm config set fetch-retry-mintimeout 10000 \
  && npm config set fetch-retry-maxtimeout 60000 \
  && npm install --omit=dev

# Copiar solo lo necesario para la Lambda basada en el servicio compartido
COPY src ./src
COPY lambda ./lambda

CMD [ "lambda/handler.handler" ]
