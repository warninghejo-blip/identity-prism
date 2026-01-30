FROM nginx:1.25-alpine

WORKDIR /usr/share/nginx/html

COPY dist/ /usr/share/nginx/html/

EXPOSE 3000

CMD ["nginx", "-g", "daemon off;"]
